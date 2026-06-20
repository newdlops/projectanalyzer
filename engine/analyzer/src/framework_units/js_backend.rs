//! JavaScript/TypeScript backend framework semantic unit adapter.
//!
//! This adapter scans Express and NestJS source under a detected package root
//! and emits conservative framework units without executing project code.

use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_scan::is_excluded_directory;
use crate::model::{
    full_content_range, DetectedFramework, FrameworkUnit, FrameworkUnitEdge, SourceRange,
};

use super::js_backend_support::{
    call_arguments_at, delimiter_delta, find_member_call_open, is_js_identifier, js_module_name,
    keyword_identifier, leading_width, line_range, normalized_relative_path, range_with_decorator,
    read_string_literal_value, split_top_level_arguments, Decorator,
};
use super::FrameworkUnitExtraction;

const MAX_JS_BACKEND_FILE_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_DECORATOR_LOOKBACK: usize = 8;

struct JsBackendFile {
    path: PathBuf,
}

struct UnitDraft {
    kind: &'static str,
    name: String,
    range: SourceRange,
    route_target_name: Option<String>,
    controller_parent_name: Option<String>,
}

struct CreatedUnit {
    unit: FrameworkUnit,
    route_target_name: Option<String>,
    controller_parent_name: Option<String>,
}

struct ClassInfo {
    name: String,
    range: SourceRange,
    body_end_line: usize,
}

/// Extracts backend semantic units for one detected Express or NestJS root.
pub(super) fn analyze(
    workspace_root: &Path,
    framework: &DetectedFramework,
) -> Result<FrameworkUnitExtraction, String> {
    if !matches!(framework.name.as_str(), "Express" | "NestJS") {
        return Ok(FrameworkUnitExtraction::default());
    }

    let root_path = framework_root_label(framework);
    let backend_root = resolve_framework_root(workspace_root, &root_path);
    if !backend_root.is_dir() {
        return Ok(FrameworkUnitExtraction::default());
    }

    let files = collect_js_backend_files(&backend_root)?;
    let mut extraction = FrameworkUnitExtraction::default();
    for file in files {
        add_file_units(
            workspace_root,
            &backend_root,
            &root_path,
            framework,
            &file,
            &mut extraction,
        )?;
    }
    Ok(extraction)
}

fn framework_root_label(framework: &DetectedFramework) -> String {
    match framework.root_path.as_deref() {
        Some("") | None => ".".to_string(),
        Some(root_path) => root_path.to_string(),
    }
}

fn resolve_framework_root(workspace_root: &Path, root_path: &str) -> PathBuf {
    if root_path == "." {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(root_path)
    }
}

/// Finds JS/TS source files using an explicit stack and generated-directory skips.
fn collect_js_backend_files(backend_root: &Path) -> Result<Vec<JsBackendFile>, String> {
    let mut files = Vec::new();
    let mut stack = vec![backend_root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "failed to read JavaScript backend directory {}: {error}",
                directory.display()
            )
        })?;

        for entry_result in entries {
            let entry =
                entry_result.map_err(|error| format!("failed to read directory entry: {error}"))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("failed to read file type {}: {error}", path.display()))?;

            if file_type.is_dir() {
                if !is_skipped_directory(&path) {
                    stack.push(path);
                }
                continue;
            }
            if !file_type.is_file() || !is_js_backend_file(&path) {
                continue;
            }

            let metadata = fs::metadata(&path)
                .map_err(|error| format!("failed to read metadata {}: {error}", path.display()))?;
            if metadata.len() <= MAX_JS_BACKEND_FILE_SIZE_BYTES {
                files.push(JsBackendFile { path });
            }
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn is_skipped_directory(path: &Path) -> bool {
    let name = path.file_name().and_then(|value| value.to_str());
    is_excluded_directory(path) || matches!(name, Some(".next"))
}

fn is_js_backend_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|value| value.to_str());
    if name.map(|value| value.ends_with(".d.ts")).unwrap_or(false) {
        return false;
    }

    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| matches!(extension, "ts" | "tsx" | "js" | "jsx"))
        .unwrap_or(false)
}

/// Adds one module unit plus module containment and framework-specific edges.
fn add_file_units(
    workspace_root: &Path,
    backend_root: &Path,
    root_path: &str,
    framework: &DetectedFramework,
    file: &JsBackendFile,
    extraction: &mut FrameworkUnitExtraction,
) -> Result<(), String> {
    let content = fs::read_to_string(&file.path)
        .map_err(|error| format!("failed to read {}: {error}", file.path.display()))?;
    let drafts = match framework.name.as_str() {
        "Express" => express_drafts(&content),
        "NestJS" => nestjs_drafts(&file.path, &content),
        _ => Vec::new(),
    };
    if drafts.is_empty() {
        return Ok(());
    }

    let module_range = full_content_range(&content);
    let module_name = js_module_name(backend_root, &file.path);
    let relative_file_path = normalized_relative_path(workspace_root, &file.path);
    let framework_slug = framework_slug(framework.name.as_str());
    let module_id = create_unit_id(
        framework_slug,
        root_path,
        "module",
        &relative_file_path,
        &module_name,
        &module_range,
    );

    extraction.units.push(FrameworkUnit {
        id: module_id.clone(),
        framework: framework.name.clone(),
        kind: "module".to_string(),
        name: module_name.clone(),
        qualified_name: module_name,
        root_path: root_path.to_string(),
        file_path: file.path.to_string_lossy().to_string(),
        range: module_range,
        parent_id: None,
    });

    let mut created_units = Vec::new();
    for draft in drafts {
        let created = create_child_unit(
            workspace_root,
            backend_root,
            root_path,
            framework,
            &file.path,
            &module_id,
            draft,
        );
        extraction
            .edges
            .push(create_contains_edge(&module_id, &created.unit));
        created_units.push(created);
    }

    add_route_controller_edges(&mut extraction.edges, &created_units);
    add_controller_route_contains_edges(&mut extraction.edges, &created_units);
    extraction
        .units
        .extend(created_units.into_iter().map(|created| created.unit));
    Ok(())
}

/// Extracts Express route calls and non-route `use` middleware calls.
fn express_drafts(content: &str) -> Vec<UnitDraft> {
    let lines: Vec<&str> = content.lines().collect();
    let mut drafts = Vec::new();
    let mut line_index = 0usize;

    while line_index < lines.len() {
        if !maybe_express_call(lines[line_index]) {
            line_index += 1;
            continue;
        }

        let statement = lines[line_index];
        let range = line_range(line_index, leading_width(statement), statement);
        if let Some((method, arguments)) = read_express_call(&statement) {
            add_express_call_units(method, arguments, &range, &mut drafts);
        }
        line_index += 1;
    }

    drafts
}

fn maybe_express_call(line: &str) -> bool {
    (line.contains("app.") || line.contains("router."))
        && ["get", "post", "put", "delete", "patch", "use"]
            .iter()
            .any(|method| line.contains(&format!(".{method}")))
}

fn read_express_call(statement: &str) -> Option<(&'static str, Vec<String>)> {
    let mut selected: Option<(usize, &'static str)> = None;
    for owner in ["app", "router"] {
        for method in ["get", "post", "put", "delete", "patch", "use"] {
            if let Some(open_index) = find_member_call_open(statement, owner, method) {
                if selected
                    .as_ref()
                    .map(|(current, _)| open_index < *current)
                    .unwrap_or(true)
                {
                    selected = Some((open_index, method));
                }
            }
        }
    }

    let (open_index, method) = selected?;
    let arguments = call_arguments_at(statement, open_index)?;
    Some((method, split_top_level_arguments(&arguments)))
}

fn add_express_call_units(
    method: &'static str,
    arguments: Vec<String>,
    range: &SourceRange,
    drafts: &mut Vec<UnitDraft>,
) {
    let Some(first_argument) = arguments.first() else {
        return;
    };

    if method == "use" && read_string_literal_value(first_argument).is_none() {
        if let Some(name) = handler_name(first_argument) {
            push_draft(drafts, draft("middleware", name, range.clone(), None, None));
        }
        return;
    }

    let Some(route_path) = read_string_literal_value(first_argument) else {
        return;
    };
    let handler = select_handler_name(&arguments[1..]);
    push_draft(
        drafts,
        draft(
            "route",
            format!("{} {route_path}", method.to_ascii_uppercase()),
            range.clone(),
            handler.clone(),
            None,
        ),
    );

    if let Some(name) = handler {
        push_draft(drafts, draft("controller", name, range.clone(), None, None));
    }
}

/// Extracts NestJS controller classes, route decorators, and injectable classes.
fn nestjs_drafts(file_path: &Path, content: &str) -> Vec<UnitDraft> {
    let lines: Vec<&str> = content.lines().collect();
    let classes = class_declarations(&lines);
    let mut drafts = Vec::new();

    for class_info in classes {
        let decorators = leading_decorators(&lines, class_info.range.start_line);
        if let Some(controller) = decorators
            .iter()
            .find(|decorator| decorator.name == "Controller")
        {
            push_draft(
                &mut drafts,
                draft(
                    "controller",
                    class_info.name.clone(),
                    range_with_decorator(&class_info.range, controller),
                    None,
                    None,
                ),
            );
            add_nestjs_routes(&lines, &class_info, decorator_path(controller), &mut drafts);
        } else if decorators
            .iter()
            .any(|decorator| decorator.name == "Injectable")
        {
            push_draft(
                &mut drafts,
                draft(
                    injectable_kind(file_path, &class_info.name),
                    class_info.name,
                    class_info.range,
                    None,
                    None,
                ),
            );
        }
    }

    drafts
}

fn add_nestjs_routes(
    lines: &[&str],
    class_info: &ClassInfo,
    controller_path: String,
    drafts: &mut Vec<UnitDraft>,
) {
    let start = class_info.range.start_line.saturating_add(1);
    let end = class_info.body_end_line.min(lines.len().saturating_sub(1));

    for line_index in start..=end {
        let trimmed = lines[line_index].trim_start();
        if trimmed.is_empty() || trimmed.starts_with('@') {
            continue;
        }

        if ts_method_name(trimmed).is_none() {
            continue;
        }
        for decorator in leading_decorators(lines, line_index) {
            if !matches!(
                decorator.name.as_str(),
                "Get" | "Post" | "Put" | "Delete" | "Patch"
            ) {
                continue;
            }
            let method_range = line_range(
                line_index,
                leading_width(lines[line_index]),
                lines[line_index],
            );
            let path = join_paths(&controller_path, &decorator_path(&decorator));
            push_draft(
                drafts,
                draft(
                    "route",
                    format!("{} {path}", decorator.name.to_ascii_uppercase()),
                    range_with_decorator(&method_range, &decorator),
                    None,
                    Some(class_info.name.clone()),
                ),
            );
        }
    }
}

fn class_declarations(lines: &[&str]) -> Vec<ClassInfo> {
    let mut classes = Vec::new();
    for (line_index, line) in lines.iter().enumerate() {
        let Some(name) = keyword_identifier(line.trim_start(), "class") else {
            continue;
        };
        classes.push(ClassInfo {
            name,
            range: line_range(line_index, leading_width(line), line),
            body_end_line: class_body_end(lines, line_index),
        });
    }
    classes
}

fn class_body_end(lines: &[&str], start_line: usize) -> usize {
    let mut balance = 0isize;
    let mut opened = false;
    for (line_index, line) in lines.iter().enumerate().skip(start_line) {
        if line.contains('{') {
            opened = true;
        }
        balance += delimiter_delta(line);
        if opened && line_index > start_line && balance <= 0 {
            return line_index;
        }
    }
    lines.len().saturating_sub(1)
}

fn leading_decorators(lines: &[&str], declaration_line: usize) -> Vec<Decorator> {
    let mut decorators = Vec::new();
    let mut cursor = declaration_line;
    let mut scanned = 0usize;

    while cursor > 0 && scanned < MAX_DECORATOR_LOOKBACK {
        cursor -= 1;
        scanned += 1;
        let trimmed = lines[cursor].trim_start();
        if trimmed.is_empty() {
            continue;
        }
        let Some(decorator) = read_decorator_line(lines[cursor], cursor) else {
            break;
        };
        decorators.push(decorator);
    }

    decorators.reverse();
    decorators
}

fn read_decorator_line(line: &str, line_index: usize) -> Option<Decorator> {
    let trimmed = line.trim_start().strip_prefix('@')?.trim_start();
    let target_end = trimmed
        .find(|character: char| {
            !(character == '.' || character == '_' || character.is_ascii_alphanumeric())
        })
        .unwrap_or(trimmed.len());
    let name = trimmed[..target_end].rsplit('.').next()?.to_string();
    let arguments = trimmed[target_end..]
        .find('(')
        .and_then(|open| call_arguments_at(&trimmed[target_end..], open));

    Some(Decorator {
        name,
        arguments,
        range: line_range(line_index, leading_width(line), line),
    })
}

fn decorator_path(decorator: &Decorator) -> String {
    decorator
        .arguments
        .as_deref()
        .and_then(|arguments| {
            split_top_level_arguments(arguments)
                .first()
                .and_then(|argument| read_string_literal_value(argument))
        })
        .unwrap_or_default()
}

fn injectable_kind(file_path: &Path, class_name: &str) -> &'static str {
    if class_name.ends_with("Service")
        || file_path.components().any(|component| {
            component
                .as_os_str()
                .to_str()
                .map(|part| matches!(part, "service" | "services"))
                .unwrap_or(false)
        })
    {
        "service"
    } else {
        "provider"
    }
}

fn join_paths(controller_path: &str, method_path: &str) -> String {
    let controller = controller_path.trim_matches('/');
    let method = method_path.trim_matches('/');
    match (controller.is_empty(), method.is_empty()) {
        (true, true) => "/".to_string(),
        (true, false) => format!("/{method}"),
        (false, true) => format!("/{controller}"),
        (false, false) => format!("/{controller}/{method}"),
    }
}

fn ts_method_name(trimmed: &str) -> Option<String> {
    if trimmed.starts_with("constructor") || trimmed.contains("=>") {
        return None;
    }
    let open = trimmed.find('(')?;
    let before = trimmed[..open].trim_end();
    if before.is_empty() || before.contains('=') {
        return None;
    }
    let name = before.split_whitespace().last()?.trim_start_matches('*');
    is_js_identifier(name).then(|| name.to_string())
}

fn select_handler_name(arguments: &[String]) -> Option<String> {
    arguments
        .iter()
        .rev()
        .find_map(|argument| handler_name(argument))
}

fn handler_name(argument: &str) -> Option<String> {
    let mut source = argument.trim();
    source = source.strip_prefix("async ").unwrap_or(source).trim_start();
    if source.contains("=>") {
        return None;
    }
    if let Some(name) = keyword_identifier(source, "function") {
        return Some(name);
    }
    if let Some(as_index) = source.find(" as ") {
        source = source[..as_index].trim_end();
    }
    if let Some(bind_index) = source.find(".bind(") {
        source = source[..bind_index].trim_end();
    }
    if let Some(open_index) = source.find('(') {
        source = source[..open_index].trim_end();
    }
    if !source.chars().all(|character| {
        character == '.'
            || character == '_'
            || character == '$'
            || character.is_ascii_alphanumeric()
    }) {
        return None;
    }
    let name = source.rsplit('.').next().unwrap_or("");
    is_js_identifier(name).then(|| name.to_string())
}

fn draft(
    kind: &'static str,
    name: String,
    range: SourceRange,
    route_target_name: Option<String>,
    controller_parent_name: Option<String>,
) -> UnitDraft {
    UnitDraft {
        kind,
        name,
        range,
        route_target_name,
        controller_parent_name,
    }
}

fn push_draft(drafts: &mut Vec<UnitDraft>, draft: UnitDraft) {
    let exists = drafts.iter().any(|candidate| {
        candidate.kind == draft.kind
            && candidate.name == draft.name
            && candidate.range.start_line == draft.range.start_line
            && candidate.range.start_character == draft.range.start_character
    });
    if !exists {
        drafts.push(draft);
    }
}

/// Converts a draft into the serialized framework unit model.
fn create_child_unit(
    workspace_root: &Path,
    backend_root: &Path,
    root_path: &str,
    framework: &DetectedFramework,
    file_path: &Path,
    parent_id: &str,
    draft: UnitDraft,
) -> CreatedUnit {
    let relative_file_path = normalized_relative_path(workspace_root, file_path);
    let unit = FrameworkUnit {
        id: create_unit_id(
            framework_slug(framework.name.as_str()),
            root_path,
            draft.kind,
            &relative_file_path,
            &draft.name,
            &draft.range,
        ),
        framework: framework.name.clone(),
        kind: draft.kind.to_string(),
        name: draft.name.clone(),
        qualified_name: unit_qualified_name(backend_root, file_path, &draft.name),
        root_path: root_path.to_string(),
        file_path: file_path.to_string_lossy().to_string(),
        range: draft.range,
        parent_id: Some(parent_id.to_string()),
    };
    CreatedUnit {
        unit,
        route_target_name: draft.route_target_name,
        controller_parent_name: draft.controller_parent_name,
    }
}

fn add_route_controller_edges(edges: &mut Vec<FrameworkUnitEdge>, units: &[CreatedUnit]) {
    for route in units.iter().filter(|unit| unit.unit.kind == "route") {
        let Some(target_name) = &route.route_target_name else {
            continue;
        };
        let Some(controller) = units
            .iter()
            .find(|unit| unit.unit.kind == "controller" && unit.unit.name == *target_name)
        else {
            continue;
        };
        edges.push(FrameworkUnitEdge {
            id: format!(
                "framework-unit-edge::routesTo::{}::{}",
                route.unit.id, controller.unit.id
            ),
            kind: "routesTo".to_string(),
            source_id: route.unit.id.clone(),
            target_id: controller.unit.id.clone(),
            file_path: route.unit.file_path.clone(),
            range: route.unit.range.clone(),
            confidence: "exact".to_string(),
        });
    }
}

fn add_controller_route_contains_edges(edges: &mut Vec<FrameworkUnitEdge>, units: &[CreatedUnit]) {
    for route in units.iter().filter(|unit| unit.unit.kind == "route") {
        let Some(controller_name) = &route.controller_parent_name else {
            continue;
        };
        let Some(controller) = units
            .iter()
            .find(|unit| unit.unit.kind == "controller" && unit.unit.name == *controller_name)
        else {
            continue;
        };
        edges.push(create_contains_edge(&controller.unit.id, &route.unit));
    }
}

fn create_contains_edge(source_id: &str, unit: &FrameworkUnit) -> FrameworkUnitEdge {
    FrameworkUnitEdge {
        id: format!("framework-unit-edge::contains::{source_id}::{}", unit.id),
        kind: "contains".to_string(),
        source_id: source_id.to_string(),
        target_id: unit.id.clone(),
        file_path: unit.file_path.clone(),
        range: unit.range.clone(),
        confidence: "exact".to_string(),
    }
}

fn create_unit_id(
    framework_slug: &str,
    root_path: &str,
    kind: &str,
    relative_path: &str,
    name: &str,
    range: &SourceRange,
) -> String {
    format!(
        "framework-unit::{framework_slug}::{root_path}::{kind}::{relative_path}::{name}::{}::{}",
        range.start_line, range.start_character
    )
}

fn framework_slug(framework_name: &str) -> &'static str {
    match framework_name {
        "Express" => "express",
        "NestJS" => "nestjs",
        _ => "js-backend",
    }
}

fn unit_qualified_name(root: &Path, file_path: &Path, name: &str) -> String {
    format!("{}.{}", js_module_name(root, file_path), name)
}
