//! FastAPI semantic unit adapter.
//!
//! This adapter scans Python source under a detected FastAPI root and extracts
//! conservative framework units without importing project code or executing
//! decorators.

use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_scan::is_excluded_directory;
use crate::model::{
    full_content_range, DetectedFramework, FrameworkUnit, FrameworkUnitEdge, SourceRange,
};

use super::FrameworkUnitExtraction;

const MAX_FASTAPI_FILE_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_SIGNATURE_LINES: usize = 40;

struct FastApiFile {
    path: PathBuf,
}

struct UnitDraft {
    kind: &'static str,
    name: String,
    range: SourceRange,
    route_target_name: Option<String>,
}

struct FunctionDeclaration {
    name: String,
    range: SourceRange,
    signature_text: String,
}

struct ClassDeclaration {
    name: String,
    range: SourceRange,
    header_text: String,
}

/// Extracts FastAPI semantic units for one detected FastAPI root.
pub(super) fn analyze(
    workspace_root: &Path,
    framework: &DetectedFramework,
) -> Result<FrameworkUnitExtraction, String> {
    let root_path = framework_root_label(framework);
    let fastapi_root = resolve_framework_root(workspace_root, &root_path);

    if !fastapi_root.is_dir() {
        return Ok(FrameworkUnitExtraction::default());
    }

    let files = collect_python_files(&fastapi_root)?;
    let mut extraction = FrameworkUnitExtraction::default();

    for file in files {
        add_file_units(
            workspace_root,
            &fastapi_root,
            &root_path,
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

/// Finds Python files using an explicit directory stack.
fn collect_python_files(fastapi_root: &Path) -> Result<Vec<FastApiFile>, String> {
    let mut files = Vec::new();
    let mut stack = vec![fastapi_root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "failed to read FastAPI directory {}: {error}",
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

            if !file_type.is_file() || !is_python_file(&path) {
                continue;
            }

            let metadata = fs::metadata(&path)
                .map_err(|error| format!("failed to read metadata {}: {error}", path.display()))?;
            if metadata.len() <= MAX_FASTAPI_FILE_SIZE_BYTES {
                files.push(FastApiFile { path });
            }
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

fn is_skipped_directory(path: &Path) -> bool {
    let is_site_packages = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| name == "site-packages")
        .unwrap_or(false);

    is_excluded_directory(path) || is_site_packages
}

fn is_python_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension == "py")
        .unwrap_or(false)
}

/// Adds one module unit plus child semantic units and contains edges.
fn add_file_units(
    workspace_root: &Path,
    fastapi_root: &Path,
    root_path: &str,
    file: &FastApiFile,
    extraction: &mut FrameworkUnitExtraction,
) -> Result<(), String> {
    let content = read_fastapi_file(&file.path)?;
    let drafts = create_unit_drafts(&file.path, &content);

    if drafts.is_empty() {
        return Ok(());
    }

    let module_range = full_content_range(&content);
    let module_name = python_module_name(fastapi_root, &file.path);
    let relative_file_path = normalized_relative_path(workspace_root, &file.path);
    let module_id = create_unit_id(
        root_path,
        "module",
        &relative_file_path,
        &module_name,
        &module_range,
    );

    extraction.units.push(FrameworkUnit {
        id: module_id.clone(),
        framework: "FastAPI".to_string(),
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
        let unit = create_child_unit(
            workspace_root,
            fastapi_root,
            root_path,
            &file.path,
            &module_id,
            draft,
        );
        let edge = create_contains_edge(&module_id, &unit.unit);
        created_units.push(unit);
        extraction.edges.push(edge);
    }

    add_route_controller_edges(&mut extraction.edges, &created_units);
    extraction
        .units
        .extend(created_units.into_iter().map(|created| created.unit));

    Ok(())
}

fn read_fastapi_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("failed to read {}: {error}", path.display()))
}

/// Creates semantic unit drafts for one Python file.
fn create_unit_drafts(file_path: &Path, content: &str) -> Vec<UnitDraft> {
    let lines: Vec<&str> = content.lines().collect();
    let mut units = Vec::new();

    for (line_index, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let indent = line.len().saturating_sub(trimmed.len());
        if indent > 0 {
            continue;
        }

        if let Some(name) = read_fastapi_app_name(trimmed) {
            units.push(UnitDraft {
                kind: "app",
                name,
                range: line_range(line_index, indent, line),
                route_target_name: None,
            });
            continue;
        }

        if let Some(class_declaration) = read_class_declaration(&lines, line_index, indent) {
            add_class_units(file_path, class_declaration, &mut units);
            continue;
        }

        if let Some(function_declaration) = read_function_declaration(&lines, line_index, indent) {
            add_function_units(
                &lines,
                line_index,
                file_path,
                function_declaration,
                &mut units,
            );
        }
    }

    units
}

fn add_class_units(
    file_path: &Path,
    class_declaration: ClassDeclaration,
    units: &mut Vec<UnitDraft>,
) {
    if is_pydantic_base_model(&class_declaration.header_text) {
        units.push(UnitDraft {
            kind: "schema",
            name: class_declaration.name,
            range: class_declaration.range,
            route_target_name: None,
        });
    } else if is_service_class(file_path, &class_declaration.name) {
        units.push(UnitDraft {
            kind: "service",
            name: class_declaration.name,
            range: class_declaration.range,
            route_target_name: None,
        });
    }
}

/// Adds route, dependency, and service units for one top-level function.
fn add_function_units(
    lines: &[&str],
    line_index: usize,
    file_path: &Path,
    function_declaration: FunctionDeclaration,
    units: &mut Vec<UnitDraft>,
) {
    let route_decorators = route_decorator_lines(lines, line_index);
    let is_route = !route_decorators.is_empty();

    if is_route {
        units.push(UnitDraft {
            kind: "controller",
            name: function_declaration.name.clone(),
            range: function_declaration.range.clone(),
            route_target_name: None,
        });
    }

    for decorator_index in route_decorators {
        let decorator_line = lines[decorator_index];
        let decorator_indent = decorator_line
            .len()
            .saturating_sub(decorator_line.trim_start().len());

        units.push(UnitDraft {
            kind: "route",
            name: route_name_from_decorator(decorator_line, &function_declaration.name),
            range: multi_line_range(
                decorator_index,
                decorator_indent,
                function_declaration.range.end_line,
                lines[function_declaration.range.end_line],
            ),
            route_target_name: Some(function_declaration.name.clone()),
        });
    }

    let dependency_names = depends_target_names(&function_declaration.signature_text);
    if dependency_names.is_empty() && function_declaration.signature_text.contains("Depends(") {
        units.push(UnitDraft {
            kind: "dependency",
            name: function_declaration.name.clone(),
            range: function_declaration.range.clone(),
            route_target_name: None,
        });
    }
    for dependency_name in dependency_names {
        units.push(UnitDraft {
            kind: "dependency",
            name: dependency_name,
            range: function_declaration.range.clone(),
            route_target_name: None,
        });
    }

    if !is_route && is_service_function(file_path, &function_declaration.name) {
        units.push(UnitDraft {
            kind: "service",
            name: function_declaration.name,
            range: function_declaration.range,
            route_target_name: None,
        });
    }
}

fn read_fastapi_app_name(line: &str) -> Option<String> {
    if !line.contains("FastAPI(") {
        return None;
    }

    let assignment_index = line.find('=')?;
    let left_side = line[..assignment_index].trim();
    let target = left_side.split(':').next().unwrap_or(left_side).trim();

    if is_python_identifier(target) {
        Some(target.to_string())
    } else {
        None
    }
}

fn read_class_declaration(
    lines: &[&str],
    start_line: usize,
    start_character: usize,
) -> Option<ClassDeclaration> {
    let trimmed = lines[start_line].trim_start();
    let name = read_declaration_name(trimmed, "class")?;
    let (header_text, end_line) = read_header_block(lines, start_line);

    Some(ClassDeclaration {
        name,
        range: multi_line_range(start_line, start_character, end_line, lines[end_line]),
        header_text,
    })
}

fn read_function_declaration(
    lines: &[&str],
    start_line: usize,
    start_character: usize,
) -> Option<FunctionDeclaration> {
    let trimmed = lines[start_line].trim_start();
    let name = read_declaration_name(trimmed, "def")
        .or_else(|| read_declaration_name(trimmed, "async def"))?;
    let (signature_text, end_line) = read_header_block(lines, start_line);

    Some(FunctionDeclaration {
        name,
        range: multi_line_range(start_line, start_character, end_line, lines[end_line]),
        signature_text,
    })
}

fn read_declaration_name(line: &str, keyword: &str) -> Option<String> {
    let remainder = line.strip_prefix(keyword)?;

    if !remainder
        .chars()
        .next()
        .map(|character| character.is_whitespace())
        .unwrap_or(false)
    {
        return None;
    }

    let name_source = remainder.trim_start();
    let end = name_source
        .find(|character: char| !(character == '_' || character.is_ascii_alphanumeric()))
        .unwrap_or(name_source.len());

    if end == 0 {
        None
    } else {
        Some(name_source[..end].to_string())
    }
}

fn read_header_block(lines: &[&str], start_line: usize) -> (String, usize) {
    let mut text = String::new();
    let mut balance = 0isize;
    let max_end = lines.len().min(start_line + MAX_SIGNATURE_LINES);

    for (line_index, line) in lines.iter().enumerate().take(max_end).skip(start_line) {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(line);
        balance += delimiter_delta(line);

        if header_has_terminal_colon(line, balance) {
            return (text, line_index);
        }
    }

    (text, max_end.saturating_sub(1))
}

fn header_has_terminal_colon(line: &str, balance: isize) -> bool {
    if balance > 0 {
        return false;
    }

    let trimmed = line.trim_end();
    if trimmed.ends_with(':') {
        return true;
    }

    trimmed
        .rfind(':')
        .map(|colon_index| trimmed[colon_index + 1..].trim_start().starts_with('#'))
        .unwrap_or(false)
}

fn route_decorator_lines(lines: &[&str], function_line_index: usize) -> Vec<usize> {
    let mut decorators = Vec::new();
    let mut current_index = function_line_index;

    while current_index > 0 {
        let previous_index = current_index - 1;
        let previous_line = lines[previous_index];
        let trimmed = previous_line.trim_start();

        if !trimmed.starts_with('@') {
            break;
        }

        let is_route = is_route_decorator(trimmed);
        if is_route {
            decorators.push(previous_index);
        }
        current_index = previous_index;
    }

    decorators.reverse();
    decorators
}

fn is_route_decorator(trimmed_line: &str) -> bool {
    let decorator = match trimmed_line.strip_prefix('@') {
        Some(value) => value.trim_start(),
        None => return false,
    };
    let call_target_end = decorator.find('(').unwrap_or(decorator.len());
    let call_target = decorator[..call_target_end].trim();
    let Some((owner, method)) = call_target.rsplit_once('.') else {
        return false;
    };
    let owner_name = owner.rsplit('.').next().unwrap_or(owner);

    is_fastapi_route_owner(owner_name) && is_fastapi_route_method(method)
}

fn is_fastapi_route_owner(name: &str) -> bool {
    name == "app" || name == "router" || name.ends_with("_app") || name.ends_with("_router")
}

fn is_fastapi_route_method(method: &str) -> bool {
    matches!(
        method,
        "get"
            | "post"
            | "put"
            | "delete"
            | "patch"
            | "options"
            | "head"
            | "trace"
            | "websocket"
            | "api_route"
    )
}

fn route_name_from_decorator(decorator_line: &str, fallback: &str) -> String {
    let trimmed = decorator_line.trim_start().trim_start_matches('@').trim();
    let call_target_end = trimmed.find('(').unwrap_or(trimmed.len());
    let call_target = trimmed[..call_target_end].trim();
    let method = call_target
        .rsplit('.')
        .next()
        .unwrap_or("route")
        .to_ascii_uppercase();
    let path = call_arguments(trimmed)
        .and_then(first_string_literal)
        .unwrap_or_else(|| fallback.to_string());

    format!("{method} {path}")
}

fn call_arguments(statement: &str) -> Option<&str> {
    let open = statement.find('(')?;
    let close = statement.rfind(')')?;

    if close <= open {
        None
    } else {
        Some(&statement[open + 1..close])
    }
}

fn first_string_literal(arguments: &str) -> Option<String> {
    let first_quote = arguments.find(|character| character == '\'' || character == '"')?;
    let quote = arguments[first_quote..].chars().next()?;
    let remainder = &arguments[first_quote + quote.len_utf8()..];
    let end = remainder.find(quote)?;

    Some(remainder[..end].to_string())
}

/// Extracts simple dependency callable names from `Depends(name)` expressions.
fn depends_target_names(source: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut search_start = 0usize;

    while let Some(relative_index) = source[search_start..].find("Depends(") {
        let start = search_start + relative_index + "Depends(".len();
        let argument = source[start..].trim_start();
        let end = argument
            .find(|character: char| {
                !(character == '_' || character == '.' || character.is_ascii_alphanumeric())
            })
            .unwrap_or(argument.len());

        if end > 0 {
            let candidate = argument[..end].rsplit('.').next().unwrap_or("").to_string();
            if !candidate.is_empty() && !names.contains(&candidate) {
                names.push(candidate);
            }
        }

        search_start = start;
    }

    names
}

fn is_pydantic_base_model(header_text: &str) -> bool {
    contains_identifier(header_text, "BaseModel")
}

fn is_service_class(file_path: &Path, name: &str) -> bool {
    name.ends_with("Service") || is_service_file(file_path)
}

fn is_service_function(file_path: &Path, name: &str) -> bool {
    is_service_file(file_path) || name.ends_with("_service")
}

/// Matches service modules without treating every FastAPI helper as a service.
fn is_service_file(file_path: &Path) -> bool {
    file_path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|part| matches!(part, "service" | "services" | "service.py" | "services.py"))
            .unwrap_or(false)
    })
}

fn contains_identifier(source: &str, identifier: &str) -> bool {
    let mut search_start = 0usize;

    while let Some(relative_index) = source[search_start..].find(identifier) {
        let start = search_start + relative_index;
        let end = start + identifier.len();
        let before = source[..start].chars().next_back();
        let after = source[end..].chars().next();

        if !is_identifier_character(before) && !is_identifier_character(after) {
            return true;
        }

        search_start = end;
    }

    false
}

fn is_identifier_character(character: Option<char>) -> bool {
    character
        .map(|value| value == '_' || value.is_ascii_alphanumeric())
        .unwrap_or(false)
}

fn is_python_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };

    (first == '_' || first.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn delimiter_delta(line: &str) -> isize {
    let mut delta = 0isize;

    for character in line.chars() {
        match character {
            '(' | '[' | '{' => delta += 1,
            ')' | ']' | '}' => delta -= 1,
            _ => {}
        }
    }

    delta
}

struct CreatedUnit {
    unit: FrameworkUnit,
    route_target_name: Option<String>,
}

/// Converts a draft into the graph model with a parent module ID.
fn create_child_unit(
    workspace_root: &Path,
    fastapi_root: &Path,
    root_path: &str,
    file_path: &Path,
    parent_id: &str,
    draft: UnitDraft,
) -> CreatedUnit {
    let relative_file_path = normalized_relative_path(workspace_root, file_path);

    let unit = FrameworkUnit {
        id: create_unit_id(
            root_path,
            draft.kind,
            &relative_file_path,
            &draft.name,
            &draft.range,
        ),
        framework: "FastAPI".to_string(),
        kind: draft.kind.to_string(),
        name: draft.name.clone(),
        qualified_name: unit_qualified_name(fastapi_root, file_path, &draft.name),
        root_path: root_path.to_string(),
        file_path: file_path.to_string_lossy().to_string(),
        range: draft.range,
        parent_id: Some(parent_id.to_string()),
    };

    CreatedUnit {
        unit,
        route_target_name: draft.route_target_name,
    }
}

/// Adds route-to-controller edges between units created from the same file.
fn add_route_controller_edges(edges: &mut Vec<FrameworkUnitEdge>, created_units: &[CreatedUnit]) {
    for route in created_units
        .iter()
        .filter(|created| created.unit.kind == "route")
    {
        let Some(target_name) = &route.route_target_name else {
            continue;
        };
        let Some(controller) = created_units
            .iter()
            .find(|created| created.unit.kind == "controller" && created.unit.name == *target_name)
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
    root_path: &str,
    kind: &str,
    relative_path: &str,
    name: &str,
    range: &SourceRange,
) -> String {
    format!(
        "framework-unit::fastapi::{root_path}::{kind}::{relative_path}::{name}::{}::{}",
        range.start_line, range.start_character
    )
}

fn unit_qualified_name(fastapi_root: &Path, file_path: &Path, name: &str) -> String {
    format!("{}.{}", python_module_name(fastapi_root, file_path), name)
}

fn python_module_name(fastapi_root: &Path, file_path: &Path) -> String {
    let path_without_extension = file_path.with_extension("");
    let relative = path_without_extension
        .strip_prefix(fastapi_root)
        .unwrap_or(&path_without_extension);
    let mut parts = Vec::new();

    for component in relative.components() {
        if let Some(part) = component.as_os_str().to_str() {
            if !part.is_empty() {
                parts.push(part.to_string());
            }
        }
    }

    parts.join(".")
}

fn normalized_relative_path(base: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(base).unwrap_or(path);

    if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    }
}

fn line_range(line_index: usize, start_character: usize, line: &str) -> SourceRange {
    multi_line_range(line_index, start_character, line_index, line)
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
