//! Lightweight manifest parsing helpers.

/// Extracts a JSON object field body by tracking braces and string literals.
pub(super) fn find_json_object_field<'a>(content: &'a str, field_name: &str) -> Option<&'a str> {
    let needle = format!("\"{field_name}\"");
    let mut search_start = 0usize;

    while let Some(offset) = content[search_start..].find(&needle) {
        let field_start = search_start + offset + needle.len();
        let after_name = content[field_start..].trim_start();
        let Some(after_colon) = after_name.strip_prefix(':') else {
            search_start = field_start;
            continue;
        };
        let after_colon = after_colon.trim_start();

        if !after_colon.starts_with('{') {
            search_start = field_start;
            continue;
        }

        let object_start = content.len() - after_colon.len();
        if let Some(object_end) = find_matching_json_object_end(content, object_start) {
            return content.get(object_start + 1..object_end);
        }

        search_start = field_start;
    }

    None
}

/// Returns true when a JSON object contains an exact quoted dependency key.
pub(super) fn section_contains_json_key(section: &str, key: &str) -> bool {
    section.contains(&format!("\"{key}\""))
}

/// Returns whether script content contains a standalone command token.
pub(super) fn contains_command_token(content: &str, token: &str) -> bool {
    let mut search_start = 0usize;

    while let Some(offset) = content[search_start..].find(token) {
        let start = search_start + offset;
        let end = start + token.len();
        let before = content[..start].chars().next_back();
        let after = content[end..].chars().next();

        if !is_command_token_character(before) && !is_command_token_character(after) {
            return true;
        }

        search_start = end;
    }

    false
}

/// Detects Python dependencies across requirements, TOML, and setup.py formats.
pub(super) fn python_manifest_declares_dependency(
    manifest_name: &str,
    content: &str,
    package_name: &str,
) -> bool {
    if manifest_name == "requirements.txt" {
        return content
            .lines()
            .filter_map(read_requirement_name)
            .any(|name| name == package_name);
    }

    content
        .lines()
        .map(strip_hash_comment)
        .any(|line| toml_or_setup_line_declares_dependency(line, package_name))
}

/// Detects Rust dependency declarations in dependency-like Cargo sections.
pub(super) fn cargo_manifest_declares_dependency(content: &str, package_name: &str) -> bool {
    let mut in_dependency_section = false;

    for line in content.lines().map(strip_hash_comment) {
        let trimmed = line.trim();

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let section = trimmed.trim_matches(['[', ']']);
            if cargo_section_is_package_dependency(section, package_name) {
                return true;
            }
            in_dependency_section = cargo_section_is_dependency_table(section);
            continue;
        }

        if !in_dependency_section {
            continue;
        }

        if let Some((key, _value)) = trimmed.split_once('=') {
            if key.trim().trim_matches('"') == package_name {
                return true;
            }
        }
    }

    false
}

/// Extracts required module paths from single-line and block go.mod require forms.
pub(super) fn read_go_required_modules(content: &str) -> Vec<String> {
    let mut modules = Vec::new();
    let mut in_require_block = false;

    for line in content.lines() {
        let trimmed = strip_slash_comment(line).trim();

        if trimmed.is_empty() {
            continue;
        }

        if in_require_block {
            if trimmed == ")" {
                in_require_block = false;
                continue;
            }

            if let Some(module_path) = trimmed.split_whitespace().next() {
                modules.push(module_path.to_string());
            }
            continue;
        }

        if trimmed == "require (" {
            in_require_block = true;
            continue;
        }

        if let Some(requirement) = trimmed.strip_prefix("require ") {
            if let Some(module_path) = requirement.split_whitespace().next() {
                modules.push(module_path.to_string());
            }
        }
    }

    modules
}

/// Detects `gem "name"` declarations while ignoring commented lines.
pub(super) fn gemfile_line_declares_gem(line: &str, gem_name: &str) -> bool {
    let trimmed = strip_hash_comment(line).trim_start();
    let Some(remainder) = trimmed.strip_prefix("gem") else {
        return false;
    };
    let remainder = remainder.trim_start();

    if !(remainder.starts_with('"') || remainder.starts_with('\'')) {
        return false;
    }

    quoted_requirements(remainder)
        .first()
        .is_some_and(|name| *name == gem_name)
}

/// Finds the closing brace for a JSON object without parsing full JSON.
fn find_matching_json_object_end(content: &str, object_start: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, character) in content[object_start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }

            match character {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match character {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(object_start + offset);
                }
            }
            _ => {}
        }
    }

    None
}

/// Returns true for characters that are part of package or command names.
fn is_command_token_character(character: Option<char>) -> bool {
    character.is_some_and(|value| {
        value.is_ascii_alphanumeric() || matches!(value, '_' | '-' | '/' | '@' | '.' | ':')
    })
}

/// Reads the normalized package name at the start of a requirements.txt line.
fn read_requirement_name(line: &str) -> Option<String> {
    let line = strip_hash_comment(line).trim();

    if line.is_empty()
        || line.starts_with('-')
        || line.starts_with("http://")
        || line.starts_with("https://")
        || line.starts_with("git+")
    {
        return None;
    }

    let end = line
        .find(|character: char| {
            !(character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
                || character == '.')
        })
        .unwrap_or(line.len());
    let name = line[..end].split('[').next().unwrap_or_default();
    normalize_dependency_name(name)
}

/// Returns true when a TOML/setup.py line declares a dependency name.
fn toml_or_setup_line_declares_dependency(line: &str, package_name: &str) -> bool {
    let trimmed = line.trim();

    if trimmed.is_empty() {
        return false;
    }

    if let Some((key, _value)) = trimmed.split_once('=') {
        if normalize_dependency_name(key.trim().trim_matches('"').trim_matches('\''))
            .is_some_and(|name| name == package_name)
        {
            return true;
        }
    }

    quoted_requirements(trimmed).into_iter().any(|requirement| {
        read_requirement_name(requirement).is_some_and(|name| name == package_name)
    })
}

/// Returns quoted strings that may represent dependency requirements.
fn quoted_requirements(line: &str) -> Vec<&str> {
    let mut requirements = Vec::new();
    let mut quote_start: Option<usize> = None;
    let mut quote_character = '\0';
    let mut escaped = false;

    for (index, character) in line.char_indices() {
        if let Some(start) = quote_start {
            if escaped {
                escaped = false;
                continue;
            }

            match character {
                '\\' => escaped = true,
                value if value == quote_character => {
                    if let Some(requirement) = line.get(start..index) {
                        requirements.push(requirement.trim());
                    }
                    quote_start = None;
                }
                _ => {}
            }
            continue;
        }

        if character == '"' || character == '\'' {
            quote_start = Some(index + character.len_utf8());
            quote_character = character;
        }
    }

    requirements
}

/// Returns true when a Cargo section is a dependency table for one package.
fn cargo_section_is_package_dependency(section: &str, package_name: &str) -> bool {
    section == format!("dependencies.{package_name}")
        || section == format!("dev-dependencies.{package_name}")
        || section == format!("build-dependencies.{package_name}")
        || section.ends_with(&format!(".dependencies.{package_name}"))
        || section.ends_with(&format!(".dev-dependencies.{package_name}"))
}

/// Returns true when a Cargo section can contain dependency keys.
fn cargo_section_is_dependency_table(section: &str) -> bool {
    section == "dependencies"
        || section == "dev-dependencies"
        || section == "build-dependencies"
        || section.ends_with(".dependencies")
        || section.ends_with(".dev-dependencies")
}

/// Removes a TOML, requirements, or Ruby comment from a line.
fn strip_hash_comment(line: &str) -> &str {
    line.split('#').next().unwrap_or_default()
}

/// Removes a Go line comment from a line.
fn strip_slash_comment(line: &str) -> &str {
    line.split("//").next().unwrap_or_default()
}

/// Normalizes package names for ecosystems with case-insensitive dependency IDs.
fn normalize_dependency_name(name: &str) -> Option<String> {
    let normalized = name
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .split('[')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace('_', "-");

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}
