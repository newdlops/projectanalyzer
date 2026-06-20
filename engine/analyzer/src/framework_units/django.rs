//! Django semantic unit adapter.
//!
//! The adapter scans Django convention files under a detected framework root and
//! emits app-scoped semantic units without importing or executing project code.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_scan::is_excluded_directory;
use crate::model::{
    full_content_range, DetectedFramework, FrameworkUnit, FrameworkUnitEdge, SourceRange,
};

use super::django_routes::{route_drafts, RouteTarget};
use super::FrameworkUnitExtraction;

const MAX_DJANGO_FILE_SIZE_BYTES: u64 = 1024 * 1024;

/// Django convention file selected for semantic unit extraction.
#[derive(Clone)]
struct DjangoFile {
    path: PathBuf,
    app_dir: PathBuf,
    kind: DjangoFileKind,
}

/// Supported Django convention files and their semantic role.
#[derive(Clone, Copy, PartialEq, Eq)]
enum DjangoFileKind {
    Settings,
    Urls,
    Apps,
    Models,
    Views,
    Serializers,
    Command,
}

/// Files grouped under one Django app or project package directory.
struct DjangoApp {
    app_dir: PathBuf,
    files: Vec<DjangoFile>,
}

/// Unit data before graph identity and parent links are assigned.
struct UnitDraft {
    kind: &'static str,
    name: String,
    range: SourceRange,
    route_target: Option<RouteTarget>,
}

/// Route edge that can be resolved after all app units have been collected.
struct PendingRouteEdge {
    source_id: String,
    target: RouteTarget,
    file_path: String,
    range: SourceRange,
}

/// Extracts Django semantic units for one detected Django root.
pub(super) fn analyze(
    workspace_root: &Path,
    framework: &DetectedFramework,
) -> Result<FrameworkUnitExtraction, String> {
    let root_path = framework_root_label(framework);
    let django_root = resolve_framework_root(workspace_root, &root_path);

    if !django_root.is_dir() {
        return Ok(FrameworkUnitExtraction::default());
    }

    let files = collect_django_files(&django_root)?;
    let apps = group_files_by_app(files);
    let mut extraction = FrameworkUnitExtraction::default();
    let mut pending_route_edges = Vec::new();

    for app in apps.into_values() {
        add_app_units(
            workspace_root,
            &django_root,
            &root_path,
            &app,
            &mut extraction,
            &mut pending_route_edges,
        )?;
    }

    add_resolved_route_edges(&mut extraction, pending_route_edges);
    Ok(extraction)
}

/// Returns the detector root label used in JSON and stable IDs.
fn framework_root_label(framework: &DetectedFramework) -> String {
    match framework.root_path.as_deref() {
        Some("") | None => ".".to_string(),
        Some(root_path) => root_path.to_string(),
    }
}

/// Resolves a detector root label back to a filesystem path.
fn resolve_framework_root(workspace_root: &Path, root_path: &str) -> PathBuf {
    if root_path == "." {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(root_path)
    }
}

/// Finds Django convention files using an explicit directory stack.
fn collect_django_files(django_root: &Path) -> Result<Vec<DjangoFile>, String> {
    let mut files = Vec::new();
    let mut stack = vec![django_root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "failed to read Django directory {}: {error}",
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

            if !file_type.is_file() {
                continue;
            }

            let Some(file) = classify_django_file(&path) else {
                continue;
            };
            let metadata = fs::metadata(&path)
                .map_err(|error| format!("failed to read metadata {}: {error}", path.display()))?;

            if metadata.len() <= MAX_DJANGO_FILE_SIZE_BYTES {
                files.push(file);
            }
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

/// Skips dependency and generated directories during framework unit scans.
fn is_skipped_directory(path: &Path) -> bool {
    let is_site_packages = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| name == "site-packages")
        .unwrap_or(false);

    is_excluded_directory(path) || is_site_packages
}

/// Classifies one path as a Django convention file when supported.
fn classify_django_file(path: &Path) -> Option<DjangoFile> {
    let name = path.file_name()?.to_str()?;
    let parent = path.parent()?.to_path_buf();

    let kind = match name {
        "settings.py" => DjangoFileKind::Settings,
        "urls.py" => DjangoFileKind::Urls,
        "apps.py" => DjangoFileKind::Apps,
        "models.py" => DjangoFileKind::Models,
        "views.py" => DjangoFileKind::Views,
        "serializers.py" => DjangoFileKind::Serializers,
        _ => return classify_management_command_file(path),
    };

    Some(DjangoFile {
        path: path.to_path_buf(),
        app_dir: parent,
        kind,
    })
}

/// Classifies `management/commands/*.py` command modules.
fn classify_management_command_file(path: &Path) -> Option<DjangoFile> {
    if path.extension()?.to_str()? != "py" || path.file_stem()?.to_str()? == "__init__" {
        return None;
    }

    let commands_dir = path.parent()?;
    if commands_dir.file_name()?.to_str()? != "commands" {
        return None;
    }

    let management_dir = commands_dir.parent()?;
    if management_dir.file_name()?.to_str()? != "management" {
        return None;
    }

    Some(DjangoFile {
        path: path.to_path_buf(),
        app_dir: management_dir.parent()?.to_path_buf(),
        kind: DjangoFileKind::Command,
    })
}

/// Groups convention files by the app directory that owns their semantic units.
fn group_files_by_app(files: Vec<DjangoFile>) -> BTreeMap<PathBuf, DjangoApp> {
    let mut apps: BTreeMap<PathBuf, DjangoApp> = BTreeMap::new();

    for file in files {
        let app_dir = file.app_dir.clone();
        apps.entry(app_dir.clone())
            .or_insert_with(|| DjangoApp {
                app_dir,
                files: Vec::new(),
            })
            .files
            .push(file);
    }

    apps
}

/// Adds one app unit plus all child semantic units and contains edges.
fn add_app_units(
    workspace_root: &Path,
    django_root: &Path,
    root_path: &str,
    app: &DjangoApp,
    extraction: &mut FrameworkUnitExtraction,
    pending_route_edges: &mut Vec<PendingRouteEdge>,
) -> Result<(), String> {
    let marker = select_app_marker(&app.files);
    let marker_content = read_django_file(&marker.path)?;
    let app_range = full_content_range(&marker_content);
    let app_id = create_unit_id(
        root_path,
        "app",
        &normalized_relative_path(workspace_root, &app.app_dir),
        &app_name(django_root, &app.app_dir),
        &app_range,
    );

    extraction.units.push(FrameworkUnit {
        id: app_id.clone(),
        framework: "Django".to_string(),
        kind: "app".to_string(),
        name: app_name(django_root, &app.app_dir),
        qualified_name: app_qualified_name(django_root, &app.app_dir),
        root_path: root_path.to_string(),
        file_path: marker.path.to_string_lossy().to_string(),
        range: app_range,
        parent_id: None,
    });

    for file in &app.files {
        let content = read_django_file(&file.path)?;

        for draft in create_unit_drafts(file, &content) {
            let unit = create_child_unit(
                workspace_root,
                django_root,
                root_path,
                &file.path,
                &app_id,
                draft,
            );
            if let Some(route_target) = unit.route_target.clone() {
                pending_route_edges.push(PendingRouteEdge {
                    source_id: unit.unit.id.clone(),
                    target: route_target,
                    file_path: unit.unit.file_path.clone(),
                    range: unit.unit.range.clone(),
                });
            }
            let edge = create_contains_edge(&app_id, &unit.unit);
            extraction.units.push(unit.unit);
            extraction.edges.push(edge);
        }
    }

    Ok(())
}

/// Selects the file that anchors the app unit range and file path.
fn select_app_marker(files: &[DjangoFile]) -> &DjangoFile {
    for preferred_kind in [
        DjangoFileKind::Apps,
        DjangoFileKind::Settings,
        DjangoFileKind::Models,
        DjangoFileKind::Urls,
        DjangoFileKind::Views,
        DjangoFileKind::Serializers,
        DjangoFileKind::Command,
    ] {
        if let Some(file) = files.iter().find(|file| file.kind == preferred_kind) {
            return file;
        }
    }

    &files[0]
}

/// Reads a selected Django file as UTF-8 source text.
fn read_django_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("failed to read {}: {error}", path.display()))
}

/// Creates semantic units for one Django convention file.
fn create_unit_drafts(file: &DjangoFile, content: &str) -> Vec<UnitDraft> {
    match file.kind {
        DjangoFileKind::Settings => vec![file_level_unit("configuration", &file.path, content)],
        DjangoFileKind::Urls => route_units_or_file_unit(&file.path, content),
        DjangoFileKind::Apps => first_declaration_or_file_unit(
            "configuration",
            &file.path,
            content,
            &[Declaration::Class],
        ),
        DjangoFileKind::Models => {
            declaration_units_or_file_unit("model", &file.path, content, &[Declaration::Class])
        }
        DjangoFileKind::Views => declaration_units_or_file_unit(
            "view",
            &file.path,
            content,
            &[Declaration::Class, Declaration::Def, Declaration::AsyncDef],
        ),
        DjangoFileKind::Serializers => {
            declaration_units_or_file_unit("serializer", &file.path, content, &[Declaration::Class])
        }
        DjangoFileKind::Command => vec![command_unit(&file.path, content)],
    }
}

/// Returns URL pattern declarations, falling back to the URLConf file unit.
fn route_units_or_file_unit(file_path: &Path, content: &str) -> Vec<UnitDraft> {
    let mut units = route_drafts(content)
        .into_iter()
        .map(|route| UnitDraft {
            kind: "route",
            name: route.name,
            range: route.range,
            route_target: route.target,
        })
        .collect::<Vec<_>>();

    if units.is_empty() {
        units.push(file_level_unit("route", file_path, content));
    }

    units
}

/// Python declarations used by Django convention files.
#[derive(Clone, Copy)]
enum Declaration {
    Class,
    Def,
    AsyncDef,
}

/// Returns the first declaration unit, falling back to a file-level unit.
fn first_declaration_or_file_unit(
    kind: &'static str,
    file_path: &Path,
    content: &str,
    declarations: &[Declaration],
) -> Vec<UnitDraft> {
    let mut units = declaration_units(kind, content, declarations);

    if units.is_empty() {
        units.push(file_level_unit(kind, file_path, content));
    } else {
        units.truncate(1);
    }

    units
}

/// Returns declaration units, falling back to a file-level unit for empty files.
fn declaration_units_or_file_unit(
    kind: &'static str,
    file_path: &Path,
    content: &str,
    declarations: &[Declaration],
) -> Vec<UnitDraft> {
    let mut units = declaration_units(kind, content, declarations);

    if units.is_empty() {
        units.push(file_level_unit(kind, file_path, content));
    }

    units
}

/// Extracts top-level Python class and function declarations.
fn declaration_units(
    kind: &'static str,
    content: &str,
    declarations: &[Declaration],
) -> Vec<UnitDraft> {
    let mut units = Vec::new();

    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let indent = line.len().saturating_sub(trimmed.len());
        if indent > 0 {
            continue;
        }

        for declaration in declarations {
            if let Some(name) = read_declaration_name(trimmed, *declaration) {
                units.push(UnitDraft {
                    kind,
                    name,
                    range: line_range(line_index, indent, line),
                    route_target: None,
                });
                break;
            }
        }
    }

    units
}

/// Reads the Python identifier introduced by a supported declaration.
fn read_declaration_name(line: &str, declaration: Declaration) -> Option<String> {
    let keyword = match declaration {
        Declaration::Class => "class",
        Declaration::Def => "def",
        Declaration::AsyncDef => "async def",
    };
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

/// Creates a file-level unit for convention files that are semantic as a whole.
fn file_level_unit(kind: &'static str, file_path: &Path, content: &str) -> UnitDraft {
    UnitDraft {
        kind,
        name: file_stem(file_path),
        range: full_content_range(content),
        route_target: None,
    }
}

/// Creates one command unit, using the Command class range when present.
fn command_unit(file_path: &Path, content: &str) -> UnitDraft {
    let command_range = declaration_units("command", content, &[Declaration::Class])
        .into_iter()
        .find(|unit| unit.name == "Command")
        .map(|unit| unit.range)
        .unwrap_or_else(|| full_content_range(content));

    UnitDraft {
        kind: "command",
        name: file_stem(file_path),
        range: command_range,
        route_target: None,
    }
}

/// Framework unit plus non-serialized adapter context.
struct CreatedUnit {
    unit: FrameworkUnit,
    route_target: Option<RouteTarget>,
}

/// Converts a draft into the graph model with a parent app ID.
fn create_child_unit(
    workspace_root: &Path,
    django_root: &Path,
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
        framework: "Django".to_string(),
        kind: draft.kind.to_string(),
        name: draft.name.clone(),
        qualified_name: unit_qualified_name(django_root, file_path, &draft.name),
        root_path: root_path.to_string(),
        file_path: file_path.to_string_lossy().to_string(),
        range: draft.range,
        parent_id: Some(parent_id.to_string()),
    };

    CreatedUnit {
        unit,
        route_target: draft.route_target,
    }
}

/// Resolves route units to view units and records inferred route relationships.
fn add_resolved_route_edges(
    extraction: &mut FrameworkUnitExtraction,
    pending_route_edges: Vec<PendingRouteEdge>,
) {
    for pending in pending_route_edges {
        let Some(target_id) = resolve_view_unit_id(&extraction.units, &pending.target) else {
            continue;
        };

        extraction.edges.push(FrameworkUnitEdge {
            id: format!(
                "framework-unit-edge::routesTo::{}::{}",
                pending.source_id, target_id
            ),
            kind: "routesTo".to_string(),
            source_id: pending.source_id,
            target_id,
            file_path: pending.file_path,
            range: pending.range,
            confidence: "inferred".to_string(),
        });
    }
}

/// Finds a unique view unit matching one of the route target candidates.
fn resolve_view_unit_id(units: &[FrameworkUnit], target: &RouteTarget) -> Option<String> {
    for candidate in &target.candidates {
        let matches = units
            .iter()
            .filter(|unit| {
                unit.kind == "view"
                    && (unit.qualified_name == *candidate
                        || unit.qualified_name.ends_with(&format!(".{candidate}"))
                        || unit.name == *candidate)
            })
            .collect::<Vec<_>>();

        if matches.len() == 1 {
            return Some(matches[0].id.clone());
        }
    }

    None
}

/// Creates an exact contains edge from an app unit to a child unit.
fn create_contains_edge(app_id: &str, unit: &FrameworkUnit) -> FrameworkUnitEdge {
    FrameworkUnitEdge {
        id: format!("framework-unit-edge::contains::{app_id}::{}", unit.id),
        kind: "contains".to_string(),
        source_id: app_id.to_string(),
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
        "framework-unit::django::{root_path}::{kind}::{relative_path}::{name}::{}::{}",
        range.start_line, range.start_character
    )
}

/// Returns a display app name from the app directory.
fn app_name(django_root: &Path, app_dir: &Path) -> String {
    let relative = normalized_relative_path(django_root, app_dir);

    if relative == "." {
        app_dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("django")
            .to_string()
    } else {
        app_dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&relative)
            .to_string()
    }
}

/// Returns a dotted app identity scoped to the Django root.
fn app_qualified_name(django_root: &Path, app_dir: &Path) -> String {
    let relative = normalized_relative_path(django_root, app_dir);

    if relative == "." {
        app_name(django_root, app_dir)
    } else {
        relative.replace('/', ".")
    }
}

/// Returns a dotted Python module-like name for a child semantic unit.
fn unit_qualified_name(django_root: &Path, file_path: &Path, name: &str) -> String {
    let module_name = python_module_name(django_root, file_path);

    if file_stem(file_path) == name {
        module_name
    } else {
        format!("{module_name}.{name}")
    }
}

/// Converts a Python file path under the root to a dotted module path.
fn python_module_name(django_root: &Path, file_path: &Path) -> String {
    let path_without_extension = file_path.with_extension("");
    let relative = path_without_extension
        .strip_prefix(django_root)
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

/// Returns a normalized relative path for IDs and qualified names.
fn normalized_relative_path(base: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(base).unwrap_or(path);

    if relative.as_os_str().is_empty() {
        ".".to_string()
    } else {
        relative.to_string_lossy().replace('\\', "/")
    }
}

/// Returns a file stem suitable for unit names.
fn file_stem(file_path: &Path) -> String {
    file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("module")
        .to_string()
}

/// Returns the range for a declaration line.
fn line_range(line_index: usize, start_character: usize, line: &str) -> SourceRange {
    SourceRange {
        start_line: line_index,
        start_character,
        end_line: line_index,
        end_character: line.chars().count(),
    }
}
