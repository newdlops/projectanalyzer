//! JavaScript frontend framework semantic unit adapter.
//! Extracts conservative React and Next.js units without executing project code.

use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_scan::is_excluded_directory;
use crate::model::{
    full_content_range, DetectedFramework, FrameworkUnit, FrameworkUnitEdge, SourceRange,
};

use super::FrameworkUnitExtraction;

const MAX_FRONTEND_FILE_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_DECLARATION_HEADER_LINES: usize = 24;

struct UnitDraft {
    kind: &'static str,
    name: String,
    range: SourceRange,
    route_renders_component: bool,
}

impl UnitDraft {
    fn new(kind: &'static str, name: String, range: SourceRange) -> Self {
        Self {
            kind,
            name,
            range,
            route_renders_component: false,
        }
    }

    fn route(name: String, range: SourceRange, route_renders_component: bool) -> Self {
        Self {
            kind: "route",
            name,
            range,
            route_renders_component,
        }
    }
}

struct CreatedUnit {
    unit: FrameworkUnit,
    route_renders_component: bool,
}

pub(super) fn analyze(
    workspace_root: &Path,
    framework: &DetectedFramework,
) -> Result<FrameworkUnitExtraction, String> {
    if !matches!(framework.name.as_str(), "React" | "Next.js") {
        return Ok(FrameworkUnitExtraction::default());
    }

    let root_path = framework_root_label(framework);
    let frontend_root = resolve_framework_root(workspace_root, &root_path);

    if !frontend_root.is_dir() {
        return Ok(FrameworkUnitExtraction::default());
    }

    let files = collect_frontend_files(&frontend_root)?;
    let mut extraction = FrameworkUnitExtraction::default();

    for file in files {
        add_file_units(
            workspace_root,
            &frontend_root,
            &root_path,
            framework,
            &file,
            &mut extraction,
        )?;
    }

    Ok(extraction)
}

fn framework_root_label(framework: &DetectedFramework) -> String {
    framework
        .root_path
        .as_deref()
        .filter(|root_path| !root_path.is_empty())
        .unwrap_or(".")
        .to_string()
}

fn resolve_framework_root(workspace_root: &Path, root_path: &str) -> PathBuf {
    if root_path == "." {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(root_path)
    }
}

fn collect_frontend_files(frontend_root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut stack = vec![frontend_root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "failed to read frontend directory {}: {error}",
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

            if !file_type.is_file() || !is_frontend_source_file(&path) {
                continue;
            }

            let metadata = fs::metadata(&path)
                .map_err(|error| format!("failed to read metadata {}: {error}", path.display()))?;
            if metadata.len() <= MAX_FRONTEND_FILE_SIZE_BYTES {
                files.push(path);
            }
        }
    }

    files.sort();
    Ok(files)
}

fn is_skipped_directory(path: &Path) -> bool {
    let name = path.file_name().and_then(|value| value.to_str());
    is_excluded_directory(path) || name == Some(".next")
}

fn is_frontend_source_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|value| value.to_str());
    if name.map(|value| value.ends_with(".d.ts")).unwrap_or(false) {
        return false;
    }

    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("ts" | "tsx" | "js" | "jsx")
    )
}

fn add_file_units(
    workspace_root: &Path,
    frontend_root: &Path,
    root_path: &str,
    framework: &DetectedFramework,
    file_path: &Path,
    extraction: &mut FrameworkUnitExtraction,
) -> Result<(), String> {
    let content = fs::read_to_string(file_path)
        .map_err(|error| format!("failed to read {}: {error}", file_path.display()))?;
    let drafts = create_unit_drafts(frontend_root, framework, file_path, &content);

    if drafts.is_empty() {
        return Ok(());
    }

    let module_range = full_content_range(&content);
    let module_name = module_name(frontend_root, file_path);
    let relative_file_path = normalized_relative_path(workspace_root, file_path);
    let module_id = create_unit_id(
        framework,
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
        file_path: file_path.to_string_lossy().to_string(),
        range: module_range,
        parent_id: None,
    });

    let mut created_units = Vec::new();

    for draft in drafts {
        let unit = create_child_unit(
            workspace_root,
            frontend_root,
            root_path,
            framework,
            file_path,
            &module_id,
            draft,
        );
        extraction
            .edges
            .push(create_contains_edge(&module_id, &unit.unit));
        created_units.push(unit);
    }

    add_route_render_edges(&mut extraction.edges, &created_units);
    extraction
        .units
        .extend(created_units.into_iter().map(|created| created.unit));

    Ok(())
}

fn create_unit_drafts(
    frontend_root: &Path,
    framework: &DetectedFramework,
    file_path: &Path,
    content: &str,
) -> Vec<UnitDraft> {
    let mut units = Vec::new();
    let full_range = full_content_range(content);

    if framework.name == "Next.js" {
        add_next_convention_units(frontend_root, file_path, &full_range, &mut units);
    }

    add_static_declaration_units(file_path, content, &mut units);
    units
}

fn add_next_convention_units(
    frontend_root: &Path,
    file_path: &Path,
    range: &SourceRange,
    units: &mut Vec<UnitDraft>,
) {
    if let Some(draft) = next_convention_draft(frontend_root, file_path, range.clone()) {
        units.push(draft);
    }
}

fn next_convention_draft(
    frontend_root: &Path,
    file_path: &Path,
    range: SourceRange,
) -> Option<UnitDraft> {
    let parts = relative_path_parts(frontend_root, file_path);
    let stem = file_path.file_stem()?.to_str()?;

    if let Some(app_index) = parts.iter().position(|part| part == "app") {
        let route_parts = parts.get(app_index + 1..parts.len().saturating_sub(1))?;
        let route_path = route_path(route_parts, false);
        return match stem {
            "page" => Some(UnitDraft::route(format!("route {route_path}"), range, true)),
            "layout" => Some(UnitDraft::new(
                "layout",
                format!("layout {route_path}"),
                range,
            )),
            "route" => Some(UnitDraft::route(
                format!("route {route_path}"),
                range,
                false,
            )),
            _ => None,
        };
    }

    let pages_index = parts.iter().position(|part| part == "pages")?;
    let route_parts = parts.get(pages_index + 1..parts.len().saturating_sub(1))?;

    if route_parts.is_empty() && matches!(stem, "_app" | "_document") {
        return Some(UnitDraft::new("layout", format!("layout {stem}"), range));
    }

    if matches!(stem, "_app" | "_document") {
        return None;
    }

    let mut page_route_parts = route_parts.to_vec();
    page_route_parts.push(stem.to_string());
    let route_path = route_path(&page_route_parts, true);

    if route_parts
        .first()
        .map(|part| part == "api")
        .unwrap_or(false)
    {
        Some(UnitDraft::route(
            format!("route {route_path}"),
            range,
            false,
        ))
    } else {
        Some(UnitDraft::route(format!("route {route_path}"), range, true))
    }
}

fn add_static_declaration_units(file_path: &Path, content: &str, units: &mut Vec<UnitDraft>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut brace_depth = 0isize;

    for line_index in 0..lines.len() {
        let line = lines[line_index];
        let trimmed = line.trim_start();

        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('*') {
            brace_depth = (brace_depth + brace_delta(line)).max(0);
            continue;
        }

        let is_top_level = brace_depth == 0;
        if is_top_level {
            if let Some(draft) = read_default_component_draft(file_path, &lines, line_index) {
                units.push(draft);
            } else if let Some(draft) = read_named_function_draft(&lines, line_index) {
                units.push(draft);
            } else if let Some(draft) = read_class_component_draft(&lines, line_index) {
                units.push(draft);
            } else if let Some(draft) = read_const_draft(&lines, line_index) {
                units.push(draft);
            }
        }

        brace_depth = (brace_depth + brace_delta(line)).max(0);
    }
}

fn read_default_component_draft(
    file_path: &Path,
    lines: &[&str],
    line_index: usize,
) -> Option<UnitDraft> {
    let line = lines[line_index].trim_start();
    let remainder = line.strip_prefix("export")?.trim_start();
    let remainder = remainder.strip_prefix("default")?.trim_start();
    let remainder = remainder
        .strip_prefix("async")
        .unwrap_or(remainder)
        .trim_start();

    if let Some(after_keyword) = keyword_remainder(remainder, "function") {
        let name =
            read_identifier(after_keyword).unwrap_or_else(|| default_component_name(file_path));
        return Some(component_or_service_draft(
            name,
            read_declaration_header(lines, line_index),
        ));
    }

    if let Some(after_keyword) = keyword_remainder(remainder, "class") {
        let name =
            read_identifier(after_keyword).unwrap_or_else(|| default_component_name(file_path));
        return Some(component_draft(
            name,
            read_declaration_header(lines, line_index),
        ));
    }

    None
}

fn read_named_function_draft(lines: &[&str], line_index: usize) -> Option<UnitDraft> {
    let mut source = strip_export(lines[line_index].trim_start());
    source = source.strip_prefix("async").unwrap_or(source).trim_start();

    let name = read_identifier(keyword_remainder(source, "function")?)?;
    if is_hook_name(&name) {
        return Some(UnitDraft::new(
            "service",
            name,
            read_declaration_header(lines, line_index),
        ));
    }

    if is_pascal_case_identifier(&name) {
        return Some(component_draft(
            name,
            read_declaration_header(lines, line_index),
        ));
    }

    None
}

fn read_class_component_draft(lines: &[&str], line_index: usize) -> Option<UnitDraft> {
    let source = strip_export(lines[line_index].trim_start());
    let source = source
        .strip_prefix("abstract")
        .unwrap_or(source)
        .trim_start();
    let name = read_identifier(keyword_remainder(source, "class")?)?;

    if is_pascal_case_identifier(&name) {
        return Some(component_draft(
            name,
            read_declaration_header(lines, line_index),
        ));
    }

    None
}

fn read_const_draft(lines: &[&str], line_index: usize) -> Option<UnitDraft> {
    let source = strip_export(lines[line_index].trim_start());
    let after_const = keyword_remainder(source, "const")?;
    let name = read_identifier(after_const)?;
    let header_range = read_declaration_header(lines, line_index);
    let header_text = joined_header_text(lines, line_index, header_range.end_line);
    let initializer = const_initializer(&header_text)?;

    if is_schema_declaration(&name, initializer) {
        return Some(UnitDraft::new("schema", name, header_range));
    }

    if is_hook_name(&name) && is_function_initializer(initializer) {
        return Some(UnitDraft::new("service", name, header_range));
    }

    if is_pascal_case_identifier(&name) && is_function_initializer(initializer) {
        return Some(component_draft(name, header_range));
    }

    None
}

fn component_draft(name: String, range: SourceRange) -> UnitDraft {
    UnitDraft::new(component_kind(&name), name, range)
}

fn component_or_service_draft(name: String, range: SourceRange) -> UnitDraft {
    if is_hook_name(&name) {
        UnitDraft::new("service", name, range)
    } else {
        component_draft(name, range)
    }
}

fn component_kind(name: &str) -> &'static str {
    if name.ends_with("Provider") {
        "provider"
    } else {
        "component"
    }
}

fn read_declaration_header(lines: &[&str], start_line: usize) -> SourceRange {
    let max_end = lines.len().min(start_line + MAX_DECLARATION_HEADER_LINES);
    let mut end_line = start_line;

    for (line_index, line) in lines.iter().enumerate().take(max_end).skip(start_line) {
        end_line = line_index;
        let trimmed = line.trim_end();

        if trimmed.contains("=>") || trimmed.ends_with(';') || trimmed.contains('{') {
            break;
        }
    }

    multi_line_range(
        start_line,
        lines[start_line]
            .len()
            .saturating_sub(lines[start_line].trim_start().len()),
        end_line,
        lines[end_line],
    )
}

fn joined_header_text(lines: &[&str], start_line: usize, end_line: usize) -> String {
    let mut text = String::new();

    for line in lines.iter().take(end_line + 1).skip(start_line) {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(line);
    }

    text
}

fn const_initializer(header_text: &str) -> Option<&str> {
    let equal_index = header_text.find('=')?;
    Some(header_text[equal_index + 1..].trim_start())
}

fn is_function_initializer(initializer: &str) -> bool {
    let source = initializer.trim_start();
    let source = source.strip_prefix("async").unwrap_or(source).trim_start();

    source.starts_with("function") || is_direct_arrow_initializer(source)
}

fn is_direct_arrow_initializer(initializer: &str) -> bool {
    let Some(arrow_index) = initializer.find("=>") else {
        return false;
    };

    let mut prefix = initializer[..arrow_index].trim();
    prefix = prefix.strip_prefix("async").unwrap_or(prefix).trim();

    !prefix.is_empty()
        && !prefix.contains('.')
        && (prefix.starts_with('(')
            || prefix.starts_with('<')
            || prefix
                .chars()
                .next()
                .map(|character| character == '_' || character.is_ascii_alphabetic())
                .unwrap_or(false))
}

fn is_schema_declaration(name: &str, initializer: &str) -> bool {
    name.ends_with("Schema")
        && (initializer.contains("z.object(")
            || initializer.contains("yup.object(")
            || initializer.contains("new Schema(")
            || initializer.contains("defineSchema(")
            || initializer.contains("createSchema("))
}

fn keyword_remainder<'a>(source: &'a str, keyword: &str) -> Option<&'a str> {
    let remainder = source.strip_prefix(keyword)?;
    let next = remainder.chars().next()?;
    if !next.is_whitespace() && !matches!(next, '(' | '{' | '<') {
        return None;
    }
    Some(remainder.trim_start())
}

fn strip_export(source: &str) -> &str {
    source.strip_prefix("export").unwrap_or(source).trim_start()
}

fn read_identifier(source: &str) -> Option<String> {
    let mut end = 0usize;

    for (index, character) in source.char_indices() {
        let valid = if index == 0 {
            character == '_' || character == '$' || character.is_ascii_alphabetic()
        } else {
            character == '_' || character == '$' || character.is_ascii_alphanumeric()
        };

        if !valid {
            break;
        }

        end = index + character.len_utf8();
    }

    if end == 0 {
        None
    } else {
        Some(source[..end].to_string())
    }
}

fn is_pascal_case_identifier(name: &str) -> bool {
    name.chars()
        .next()
        .map(|character| character.is_ascii_uppercase())
        .unwrap_or(false)
}

fn is_hook_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("use") else {
        return false;
    };

    rest.chars()
        .next()
        .map(|character| character.is_ascii_uppercase())
        .unwrap_or(false)
}

fn default_component_name(file_path: &Path) -> String {
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("DefaultExport");
    let candidate = pascal_case_identifier(stem);

    if candidate.is_empty() {
        "DefaultExport".to_string()
    } else {
        candidate
    }
}

fn pascal_case_identifier(source: &str) -> String {
    let mut name = String::new();
    let mut uppercase_next = true;

    for character in source.chars() {
        if character.is_ascii_alphanumeric() {
            if uppercase_next {
                name.push(character.to_ascii_uppercase());
            } else {
                name.push(character);
            }
            uppercase_next = false;
        } else {
            uppercase_next = true;
        }
    }

    name
}

fn brace_delta(line: &str) -> isize {
    line.split("//")
        .next()
        .unwrap_or(line)
        .chars()
        .fold(0, |delta, character| match character {
            '{' => delta + 1,
            '}' => delta - 1,
            _ => delta,
        })
}

fn create_child_unit(
    workspace_root: &Path,
    frontend_root: &Path,
    root_path: &str,
    framework: &DetectedFramework,
    file_path: &Path,
    parent_id: &str,
    draft: UnitDraft,
) -> CreatedUnit {
    let relative_file_path = normalized_relative_path(workspace_root, file_path);

    let unit = FrameworkUnit {
        id: create_unit_id(
            framework,
            root_path,
            draft.kind,
            &relative_file_path,
            &draft.name,
            &draft.range,
        ),
        framework: framework.name.clone(),
        kind: draft.kind.to_string(),
        name: draft.name.clone(),
        qualified_name: unit_qualified_name(frontend_root, file_path, &draft.name),
        root_path: root_path.to_string(),
        file_path: file_path.to_string_lossy().to_string(),
        range: draft.range,
        parent_id: Some(parent_id.to_string()),
    };

    CreatedUnit {
        unit,
        route_renders_component: draft.route_renders_component,
    }
}

fn add_route_render_edges(edges: &mut Vec<FrameworkUnitEdge>, created_units: &[CreatedUnit]) {
    for route in created_units
        .iter()
        .filter(|created| created.unit.kind == "route" && created.route_renders_component)
    {
        let Some(component) = created_units
            .iter()
            .find(|created| created.unit.kind == "component")
        else {
            continue;
        };

        edges.push(FrameworkUnitEdge {
            id: format!(
                "framework-unit-edge::renders::{}::{}",
                route.unit.id, component.unit.id
            ),
            kind: "renders".to_string(),
            source_id: route.unit.id.clone(),
            target_id: component.unit.id.clone(),
            file_path: route.unit.file_path.clone(),
            range: route.unit.range.clone(),
            confidence: "exact".to_string(),
        });
    }
}

fn create_contains_edge(module_id: &str, unit: &FrameworkUnit) -> FrameworkUnitEdge {
    FrameworkUnitEdge {
        id: format!("framework-unit-edge::contains::{module_id}::{}", unit.id),
        kind: "contains".to_string(),
        source_id: module_id.to_string(),
        target_id: unit.id.clone(),
        file_path: unit.file_path.clone(),
        range: unit.range.clone(),
        confidence: "exact".to_string(),
    }
}

fn create_unit_id(
    framework: &DetectedFramework,
    root_path: &str,
    kind: &str,
    relative_path: &str,
    name: &str,
    range: &SourceRange,
) -> String {
    let framework_key = match framework.name.as_str() {
        "Next.js" => "nextjs",
        "React" => "react",
        _ => "frontend",
    };

    format!(
        "framework-unit::js-frontend::{}::{root_path}::{kind}::{relative_path}::{name}::{}::{}",
        framework_key, range.start_line, range.start_character
    )
}

fn unit_qualified_name(frontend_root: &Path, file_path: &Path, name: &str) -> String {
    format!("{}.{}", module_name(frontend_root, file_path), name)
}

fn module_name(frontend_root: &Path, file_path: &Path) -> String {
    relative_path_parts(frontend_root, file_path).join(".")
}

fn relative_path_parts(frontend_root: &Path, file_path: &Path) -> Vec<String> {
    let path_without_extension = file_path.with_extension("");
    let relative = path_without_extension
        .strip_prefix(frontend_root)
        .unwrap_or(&path_without_extension);
    let mut parts = Vec::new();

    for component in relative.components() {
        if let Some(part) = component.as_os_str().to_str() {
            if !part.is_empty() {
                parts.push(part.to_string());
            }
        }
    }

    parts
}

fn route_path(parts: &[String], trim_index: bool) -> String {
    let mut visible = parts
        .iter()
        .filter(|part| is_visible_route_segment(part))
        .cloned()
        .collect::<Vec<_>>();

    if trim_index && visible.last().map(|part| part == "index").unwrap_or(false) {
        visible.pop();
    }

    if visible.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", visible.join("/"))
    }
}

fn is_visible_route_segment(segment: &str) -> bool {
    !(segment.starts_with('(') && segment.ends_with(')')) && !segment.starts_with('@')
}

fn normalized_relative_path(base: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(base).unwrap_or(path);

    if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    }
}

fn multi_line_range(
    start_line: usize,
    start_character: usize,
    end_line: usize,
    end_line_text: &str,
) -> SourceRange {
    SourceRange {
        start_line,
        start_character,
        end_line,
        end_character: end_line_text.chars().count(),
    }
}
