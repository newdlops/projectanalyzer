//! Flask semantic unit adapter.
//!
//! This adapter scans Python source under a detected Flask root and extracts
//! conservative framework units without importing project code or executing
//! decorators. It keeps Flask-specific static patterns local to this module.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_scan::is_excluded_directory;
use crate::model::{
    full_content_range, DetectedFramework, FrameworkUnit, FrameworkUnitEdge, SourceRange,
};

use super::FrameworkUnitExtraction;

const MAX_FLASK_FILE_SIZE_BYTES: u64 = 1024 * 1024;
const MAX_SIGNATURE_LINES: usize = 40;

#[derive(Default)]
struct FlaskSymbols {
    app_names: BTreeSet<String>,
    blueprint_names: BTreeSet<String>,
}

struct UnitDraft {
    kind: &'static str,
    name: String,
    range: SourceRange,
    route_target_name: Option<String>,
}

struct PythonDeclaration {
    name: String,
    range: SourceRange,
}

struct CreatedUnit {
    unit: FrameworkUnit,
    route_target_name: Option<String>,
}

/// Extracts Flask semantic units for one detected Flask root.
pub(super) fn analyze(
    workspace_root: &Path,
    framework: &DetectedFramework,
) -> Result<FrameworkUnitExtraction, String> {
    let root_path = match framework.root_path.as_deref() {
        Some("") | None => ".".to_string(),
        Some(root_path) => root_path.to_string(),
    };
    let flask_root = if root_path == "." {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(&root_path)
    };

    if !flask_root.is_dir() {
        return Ok(FrameworkUnitExtraction::default());
    }

    let files = collect_python_files(&flask_root)?;
    let mut extraction = FrameworkUnitExtraction::default();

    for file_path in files {
        add_file_units(
            workspace_root,
            &flask_root,
            &root_path,
            &file_path,
            &mut extraction,
        )?;
    }

    Ok(extraction)
}

/// Finds Python files using an explicit directory stack.
fn collect_python_files(flask_root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut stack = vec![flask_root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "failed to read Flask directory {}: {error}",
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
            if metadata.len() <= MAX_FLASK_FILE_SIZE_BYTES {
                files.push(path);
            }
        }
    }

    files.sort();
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

/// Adds one module unit plus child Flask semantic units and contains edges.
fn add_file_units(
    workspace_root: &Path,
    flask_root: &Path,
    root_path: &str,
    file_path: &Path,
    extraction: &mut FrameworkUnitExtraction,
) -> Result<(), String> {
    let content = fs::read_to_string(file_path)
        .map_err(|error| format!("failed to read {}: {error}", file_path.display()))?;
    let drafts = create_unit_drafts(file_path, &content);

    if drafts.is_empty() {
        return Ok(());
    }

    let module_range = full_content_range(&content);
    let module_name = python_module_name(flask_root, file_path);
    let relative_file_path = normalized_relative_path(workspace_root, file_path);
    let module_id = create_unit_id(
        root_path,
        "module",
        &relative_file_path,
        &module_name,
        &module_range,
    );

    extraction.units.push(FrameworkUnit {
        id: module_id.clone(),
        framework: "Flask".to_string(),
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
        let created = create_child_unit(
            workspace_root,
            flask_root,
            root_path,
            file_path,
            &module_id,
            draft,
        );
        extraction
            .edges
            .push(create_contains_edge(&module_id, &created.unit));
        created_units.push(created);
    }

    add_route_controller_edges(&mut extraction.edges, &created_units);
    extraction
        .units
        .extend(created_units.into_iter().map(|created| created.unit));

    Ok(())
}

/// Creates semantic unit drafts for one Python file.
fn create_unit_drafts(file_path: &Path, content: &str) -> Vec<UnitDraft> {
    let lines: Vec<&str> = content.lines().collect();
    let symbols = read_flask_symbols(&lines);
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

        if let Some(name) = read_assignment_constructor(trimmed, "Flask") {
            units.push(UnitDraft {
                kind: "app",
                name,
                range: line_range(line_index, indent, line),
                route_target_name: None,
            });
            continue;
        }

        if let Some(name) = read_assignment_constructor(trimmed, "Blueprint") {
            units.push(UnitDraft {
                kind: "module",
                name,
                range: line_range(line_index, indent, line),
                route_target_name: None,
            });
            continue;
        }

        if let Some(class_declaration) =
            read_python_declaration(&lines, line_index, indent, &["class"])
        {
            add_class_units(file_path, class_declaration, &mut units);
            continue;
        }

        if let Some(function_declaration) =
            read_python_declaration(&lines, line_index, indent, &["def", "async def"])
        {
            add_function_units(
                &lines,
                line_index,
                file_path,
                &symbols,
                function_declaration,
                &mut units,
            );
        }
    }

    units
}

/// Reads top-level Flask app and Blueprint variable names used by decorators.
fn read_flask_symbols(lines: &[&str]) -> FlaskSymbols {
    let mut symbols = FlaskSymbols::default();

    for line in lines {
        let trimmed = line.trim_start();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let indent = line.len().saturating_sub(trimmed.len());
        if indent > 0 {
            continue;
        }

        if let Some(name) = read_assignment_constructor(trimmed, "Flask") {
            symbols.app_names.insert(name);
        }
        if let Some(name) = read_assignment_constructor(trimmed, "Blueprint") {
            symbols.blueprint_names.insert(name);
        }
    }

    symbols
}

fn add_class_units(
    file_path: &Path,
    class_declaration: PythonDeclaration,
    units: &mut Vec<UnitDraft>,
) {
    if class_declaration.name.ends_with("Service") || is_service_file(file_path) {
        units.push(UnitDraft {
            kind: "service",
            name: class_declaration.name,
            range: class_declaration.range,
            route_target_name: None,
        });
    }
}

/// Adds route, controller, middleware, and service units for one top-level function.
fn add_function_units(
    lines: &[&str],
    line_index: usize,
    file_path: &Path,
    symbols: &FlaskSymbols,
    function_declaration: PythonDeclaration,
    units: &mut Vec<UnitDraft>,
) {
    let decorators = preceding_decorator_lines(lines, line_index);
    let route_decorators = decorators
        .iter()
        .copied()
        .filter(|line_index| is_route_decorator(lines[*line_index].trim_start(), symbols))
        .collect::<Vec<_>>();
    let middleware_decorators = decorators
        .iter()
        .copied()
        .filter(|line_index| is_middleware_decorator(lines[*line_index].trim_start(), symbols))
        .collect::<Vec<_>>();
    let is_route = !route_decorators.is_empty();
    let is_middleware = !middleware_decorators.is_empty();

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

    for decorator_index in middleware_decorators {
        let decorator_line = lines[decorator_index];
        let decorator_indent = decorator_line
            .len()
            .saturating_sub(decorator_line.trim_start().len());

        units.push(UnitDraft {
            kind: "middleware",
            name: middleware_name_from_decorator(decorator_line, &function_declaration.name),
            range: multi_line_range(
                decorator_index,
                decorator_indent,
                function_declaration.range.end_line,
                lines[function_declaration.range.end_line],
            ),
            route_target_name: None,
        });
    }

    if !is_route
        && !is_middleware
        && (is_service_file(file_path) || function_declaration.name.ends_with("_service"))
    {
        units.push(UnitDraft {
            kind: "service",
            name: function_declaration.name,
            range: function_declaration.range,
            route_target_name: None,
        });
    }
}

fn read_assignment_constructor(line: &str, constructor: &str) -> Option<String> {
    if !contains_constructor_call(line, constructor) {
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

fn contains_constructor_call(line: &str, constructor: &str) -> bool {
    let mut search_start = 0usize;

    while let Some(relative_index) = line[search_start..].find(constructor) {
        let start = search_start + relative_index;
        let end = start + constructor.len();
        let before = line[..start].chars().next_back();
        let after = line[end..].chars().next();

        if !is_identifier_character(before) && after == Some('(') {
            return true;
        }

        search_start = end;
    }

    false
}

/// Reads a top-level Python declaration for one of the accepted keywords.
fn read_python_declaration(
    lines: &[&str],
    start_line: usize,
    start_character: usize,
    keywords: &[&str],
) -> Option<PythonDeclaration> {
    let trimmed = lines[start_line].trim_start();
    let name = keywords
        .iter()
        .find_map(|keyword| read_declaration_name(trimmed, keyword))?;
    let end_line = read_header_end_line(lines, start_line);

    Some(PythonDeclaration {
        name,
        range: multi_line_range(start_line, start_character, end_line, lines[end_line]),
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

/// Reads a declaration header until the terminal colon or a bounded line limit.
fn read_header_end_line(lines: &[&str], start_line: usize) -> usize {
    let mut balance = 0isize;
    let max_end = lines.len().min(start_line + MAX_SIGNATURE_LINES);

    for (line_index, line) in lines.iter().enumerate().take(max_end).skip(start_line) {
        balance += delimiter_delta(line);

        if header_has_terminal_colon(line, balance) {
            return line_index;
        }
    }

    max_end.saturating_sub(1)
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

/// Returns contiguous decorator lines immediately attached to a function.
fn preceding_decorator_lines(lines: &[&str], function_line_index: usize) -> Vec<usize> {
    let mut decorators = Vec::new();
    let mut current_index = function_line_index;

    while current_index > 0 {
        let previous_index = current_index - 1;
        let previous_line = lines[previous_index];
        let trimmed = previous_line.trim_start();

        if !trimmed.starts_with('@') {
            break;
        }

        decorators.push(previous_index);
        current_index = previous_index;
    }

    decorators.reverse();
    decorators
}

fn is_route_decorator(trimmed_line: &str, symbols: &FlaskSymbols) -> bool {
    let Some((owner_name, method)) = read_decorator_call(trimmed_line) else {
        return false;
    };

    if !is_known_flask_owner(symbols, owner_name) {
        return false;
    }

    method == "route" || is_http_shortcut_method(method)
}

fn is_middleware_decorator(trimmed_line: &str, symbols: &FlaskSymbols) -> bool {
    let Some((owner_name, method)) = read_decorator_call(trimmed_line) else {
        return false;
    };

    is_known_flask_owner(symbols, owner_name)
        && matches!(method, "before_request" | "after_request")
}

fn is_known_flask_owner(symbols: &FlaskSymbols, owner_name: &str) -> bool {
    symbols.app_names.contains(owner_name) || symbols.blueprint_names.contains(owner_name)
}

fn read_decorator_call(trimmed_line: &str) -> Option<(&str, &str)> {
    let decorator = trimmed_line.strip_prefix('@')?.trim_start();
    let call_target_end = decorator.find('(').unwrap_or(decorator.len());
    let call_target = decorator[..call_target_end].trim();
    let (owner, method) = call_target.rsplit_once('.')?;
    let owner_name = owner.rsplit('.').next().unwrap_or(owner);

    if owner_name.is_empty() || method.is_empty() {
        return None;
    }

    Some((owner_name, method))
}

fn is_http_shortcut_method(method: &str) -> bool {
    matches!(
        method,
        "get" | "post" | "put" | "delete" | "patch" | "options" | "head"
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

fn middleware_name_from_decorator(decorator_line: &str, fallback: &str) -> String {
    let trimmed = decorator_line.trim_start().trim_start_matches('@').trim();
    let call_target_end = trimmed.find('(').unwrap_or(trimmed.len());
    let call_target = trimmed[..call_target_end].trim();
    let method = call_target.rsplit('.').next().unwrap_or("middleware");

    format!("{method} {fallback}")
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
    let first_quote = arguments.find(['\'', '"'])?;
    let quote = arguments[first_quote..].chars().next()?;
    let remainder = &arguments[first_quote + quote.len_utf8()..];
    let end = remainder.find(quote)?;

    Some(remainder[..end].to_string())
}

/// Matches service modules without treating every Flask helper as a service.
fn is_service_file(file_path: &Path) -> bool {
    file_path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|part| matches!(part, "service" | "services" | "service.py" | "services.py"))
            .unwrap_or(false)
    })
}

fn is_python_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };

    (first == '_' || first.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn is_identifier_character(character: Option<char>) -> bool {
    character
        .map(|value| value == '_' || value.is_ascii_alphanumeric())
        .unwrap_or(false)
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

/// Converts a draft into the graph model with a parent module ID.
fn create_child_unit(
    workspace_root: &Path,
    flask_root: &Path,
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
        framework: "Flask".to_string(),
        kind: draft.kind.to_string(),
        name: draft.name.clone(),
        qualified_name: unit_qualified_name(flask_root, file_path, &draft.name),
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

/// Builds a stable unit ID from detector root, relative file path, and source range.
fn create_unit_id(
    root_path: &str,
    kind: &str,
    relative_path: &str,
    name: &str,
    range: &SourceRange,
) -> String {
    format!(
        "framework-unit::flask::{root_path}::{kind}::{relative_path}::{name}::{}::{}",
        range.start_line, range.start_character
    )
}

fn unit_qualified_name(flask_root: &Path, file_path: &Path, name: &str) -> String {
    format!("{}.{}", python_module_name(flask_root, file_path), name)
}

fn python_module_name(flask_root: &Path, file_path: &Path) -> String {
    let path_without_extension = file_path.with_extension("");
    let relative = path_without_extension
        .strip_prefix(flask_root)
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
