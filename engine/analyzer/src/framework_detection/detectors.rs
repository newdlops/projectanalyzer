//! Ecosystem-specific framework detectors.

use super::manifest_scan::ManifestFile;
use super::parse::{
    cargo_manifest_declares_dependency, contains_command_token, find_json_object_field,
    gemfile_line_declares_gem, python_manifest_declares_dependency, read_go_required_modules,
    section_contains_json_key,
};
use super::{FrameworkAccumulator, FrameworkDefinition, DJANGO_DEFINITION};

/// Dispatches detection by manifest name.
pub(super) fn detect_manifest(
    manifest: &ManifestFile,
    content: &str,
    accumulator: &mut FrameworkAccumulator,
) {
    match manifest.name.as_str() {
        "package.json" => detect_package_json(manifest, content, accumulator),
        "pyproject.toml" | "requirements.txt" | "setup.py" | "Pipfile" => {
            detect_python_manifest(manifest, content, accumulator)
        }
        "Cargo.toml" => detect_cargo_toml(manifest, content, accumulator),
        "go.mod" => detect_go_mod(manifest, content, accumulator),
        "build.gradle" | "build.gradle.kts" | "pom.xml" => {
            detect_jvm_manifest(manifest, content, accumulator)
        }
        "composer.json" => detect_composer_json(manifest, content, accumulator),
        "Gemfile" => detect_gemfile(manifest, content, accumulator),
        _ => {}
    }
}

/// Detects JavaScript and TypeScript frameworks from package dependencies and scripts.
fn detect_package_json(
    manifest: &ManifestFile,
    content: &str,
    accumulator: &mut FrameworkAccumulator,
) {
    const PACKAGE_DETECTIONS: &[(&str, FrameworkDefinition)] = &[
        (
            "react",
            FrameworkDefinition {
                name: "React",
                ecosystem: "javascript",
                category: "frontend",
            },
        ),
        (
            "next",
            FrameworkDefinition {
                name: "Next.js",
                ecosystem: "javascript",
                category: "fullstack",
            },
        ),
        (
            "vue",
            FrameworkDefinition {
                name: "Vue",
                ecosystem: "javascript",
                category: "frontend",
            },
        ),
        (
            "nuxt",
            FrameworkDefinition {
                name: "Nuxt",
                ecosystem: "javascript",
                category: "fullstack",
            },
        ),
        (
            "@angular/core",
            FrameworkDefinition {
                name: "Angular",
                ecosystem: "javascript",
                category: "frontend",
            },
        ),
        (
            "svelte",
            FrameworkDefinition {
                name: "Svelte",
                ecosystem: "javascript",
                category: "frontend",
            },
        ),
        (
            "@sveltejs/kit",
            FrameworkDefinition {
                name: "SvelteKit",
                ecosystem: "javascript",
                category: "fullstack",
            },
        ),
        (
            "express",
            FrameworkDefinition {
                name: "Express",
                ecosystem: "javascript",
                category: "backend",
            },
        ),
        (
            "@nestjs/core",
            FrameworkDefinition {
                name: "NestJS",
                ecosystem: "javascript",
                category: "backend",
            },
        ),
        (
            "@nestjs/graphql",
            FrameworkDefinition {
                name: "GraphQL",
                ecosystem: "javascript",
                category: "backend",
            },
        ),
        (
            "graphql",
            FrameworkDefinition {
                name: "GraphQL",
                ecosystem: "javascript",
                category: "backend",
            },
        ),
        (
            "@apollo/server",
            FrameworkDefinition {
                name: "GraphQL",
                ecosystem: "javascript",
                category: "backend",
            },
        ),
        (
            "apollo-server",
            FrameworkDefinition {
                name: "GraphQL",
                ecosystem: "javascript",
                category: "backend",
            },
        ),
        (
            "vite",
            FrameworkDefinition {
                name: "Vite",
                ecosystem: "javascript",
                category: "build",
            },
        ),
        (
            "jest",
            FrameworkDefinition {
                name: "Jest",
                ecosystem: "javascript",
                category: "test",
            },
        ),
        (
            "vitest",
            FrameworkDefinition {
                name: "Vitest",
                ecosystem: "javascript",
                category: "test",
            },
        ),
    ];
    const SCRIPT_DETECTIONS: &[(&str, FrameworkDefinition)] = &[
        (
            "react-scripts",
            FrameworkDefinition {
                name: "React",
                ecosystem: "javascript",
                category: "frontend",
            },
        ),
        (
            "next",
            FrameworkDefinition {
                name: "Next.js",
                ecosystem: "javascript",
                category: "fullstack",
            },
        ),
        (
            "vue-cli-service",
            FrameworkDefinition {
                name: "Vue",
                ecosystem: "javascript",
                category: "frontend",
            },
        ),
        (
            "nuxt",
            FrameworkDefinition {
                name: "Nuxt",
                ecosystem: "javascript",
                category: "fullstack",
            },
        ),
        (
            "ng",
            FrameworkDefinition {
                name: "Angular",
                ecosystem: "javascript",
                category: "frontend",
            },
        ),
        (
            "svelte-kit",
            FrameworkDefinition {
                name: "SvelteKit",
                ecosystem: "javascript",
                category: "fullstack",
            },
        ),
        (
            "vite",
            FrameworkDefinition {
                name: "Vite",
                ecosystem: "javascript",
                category: "build",
            },
        ),
        (
            "jest",
            FrameworkDefinition {
                name: "Jest",
                ecosystem: "javascript",
                category: "test",
            },
        ),
        (
            "vitest",
            FrameworkDefinition {
                name: "Vitest",
                ecosystem: "javascript",
                category: "test",
            },
        ),
        (
            "nest",
            FrameworkDefinition {
                name: "NestJS",
                ecosystem: "javascript",
                category: "backend",
            },
        ),
    ];

    for (section_name, evidence_label) in [
        ("dependencies", "dependency"),
        ("devDependencies", "devDependency"),
    ] {
        let Some(section) = find_json_object_field(content, section_name) else {
            continue;
        };

        for (package_name, definition) in PACKAGE_DETECTIONS {
            if section_contains_json_key(section, package_name) {
                accumulator.add(
                    &manifest.root_path,
                    definition,
                    "high",
                    format!("package.json {evidence_label}: {package_name}"),
                );
            }
        }
    }

    if let Some(scripts) = find_json_object_field(content, "scripts") {
        let scripts = scripts.to_ascii_lowercase();

        for (script_token, definition) in SCRIPT_DETECTIONS {
            if contains_command_token(&scripts, script_token) {
                accumulator.add(
                    &manifest.root_path,
                    definition,
                    "medium",
                    format!("package.json script: {script_token}"),
                );
            }
        }
    }
}

/// Detects Python frameworks from supported Python project manifests.
fn detect_python_manifest(
    manifest: &ManifestFile,
    content: &str,
    accumulator: &mut FrameworkAccumulator,
) {
    const PYTHON_DETECTIONS: &[(&str, FrameworkDefinition)] = &[
        ("django", DJANGO_DEFINITION),
        (
            "flask",
            FrameworkDefinition {
                name: "Flask",
                ecosystem: "python",
                category: "backend",
            },
        ),
        (
            "fastapi",
            FrameworkDefinition {
                name: "FastAPI",
                ecosystem: "python",
                category: "backend",
            },
        ),
        (
            "strawberry-graphql",
            FrameworkDefinition {
                name: "GraphQL",
                ecosystem: "python",
                category: "backend",
            },
        ),
        (
            "graphene",
            FrameworkDefinition {
                name: "GraphQL",
                ecosystem: "python",
                category: "backend",
            },
        ),
        (
            "pytest",
            FrameworkDefinition {
                name: "pytest",
                ecosystem: "python",
                category: "test",
            },
        ),
    ];

    for (package_name, definition) in PYTHON_DETECTIONS {
        if python_manifest_declares_dependency(&manifest.name, content, package_name) {
            accumulator.add(
                &manifest.root_path,
                definition,
                "high",
                format!("{} dependency: {package_name}", manifest.name),
            );
        }
    }
}

/// Detects Rust frameworks from Cargo dependencies.
fn detect_cargo_toml(
    manifest: &ManifestFile,
    content: &str,
    accumulator: &mut FrameworkAccumulator,
) {
    const RUST_DETECTIONS: &[(&str, FrameworkDefinition)] = &[
        (
            "axum",
            FrameworkDefinition {
                name: "Axum",
                ecosystem: "rust",
                category: "backend",
            },
        ),
        (
            "actix-web",
            FrameworkDefinition {
                name: "Actix Web",
                ecosystem: "rust",
                category: "backend",
            },
        ),
        (
            "rocket",
            FrameworkDefinition {
                name: "Rocket",
                ecosystem: "rust",
                category: "backend",
            },
        ),
        (
            "tauri",
            FrameworkDefinition {
                name: "Tauri",
                ecosystem: "rust",
                category: "desktop",
            },
        ),
    ];

    for (package_name, definition) in RUST_DETECTIONS {
        if cargo_manifest_declares_dependency(content, package_name) {
            accumulator.add(
                &manifest.root_path,
                definition,
                "high",
                format!("Cargo.toml dependency: {package_name}"),
            );
        }
    }
}

/// Detects Go frameworks from go.mod require declarations.
fn detect_go_mod(manifest: &ManifestFile, content: &str, accumulator: &mut FrameworkAccumulator) {
    const GO_DETECTIONS: &[(&str, FrameworkDefinition)] = &[
        (
            "github.com/gin-gonic/gin",
            FrameworkDefinition {
                name: "Gin",
                ecosystem: "go",
                category: "backend",
            },
        ),
        (
            "github.com/labstack/echo",
            FrameworkDefinition {
                name: "Echo",
                ecosystem: "go",
                category: "backend",
            },
        ),
        (
            "github.com/gofiber/fiber",
            FrameworkDefinition {
                name: "Fiber",
                ecosystem: "go",
                category: "backend",
            },
        ),
    ];

    for module_path in read_go_required_modules(content) {
        for (known_module_path, definition) in GO_DETECTIONS {
            if module_path == *known_module_path
                || module_path
                    .strip_prefix(known_module_path)
                    .is_some_and(|suffix| suffix.starts_with('/'))
            {
                accumulator.add(
                    &manifest.root_path,
                    definition,
                    "high",
                    format!("go.mod require: {module_path}"),
                );
            }
        }
    }
}

/// Detects Spring Boot from Gradle and Maven manifests.
fn detect_jvm_manifest(
    manifest: &ManifestFile,
    content: &str,
    accumulator: &mut FrameworkAccumulator,
) {
    let spring_boot = FrameworkDefinition {
        name: "Spring Boot",
        ecosystem: "jvm",
        category: "backend",
    };

    if content.contains("org.springframework.boot") {
        accumulator.add(
            &manifest.root_path,
            &spring_boot,
            "high",
            format!("{} plugin: org.springframework.boot", manifest.name),
        );
    }

    if content.contains("spring-boot-starter") {
        accumulator.add(
            &manifest.root_path,
            &spring_boot,
            "high",
            format!("{} dependency: spring-boot-starter", manifest.name),
        );
    }
}

/// Detects PHP frameworks from composer require declarations.
fn detect_composer_json(
    manifest: &ManifestFile,
    content: &str,
    accumulator: &mut FrameworkAccumulator,
) {
    const PHP_DETECTIONS: &[(&str, FrameworkDefinition)] = &[
        (
            "laravel/framework",
            FrameworkDefinition {
                name: "Laravel",
                ecosystem: "php",
                category: "backend",
            },
        ),
        (
            "symfony/framework-bundle",
            FrameworkDefinition {
                name: "Symfony",
                ecosystem: "php",
                category: "backend",
            },
        ),
        (
            "symfony/symfony",
            FrameworkDefinition {
                name: "Symfony",
                ecosystem: "php",
                category: "backend",
            },
        ),
    ];

    for (section_name, evidence_label) in [("require", "require"), ("require-dev", "require-dev")] {
        let Some(section) = find_json_object_field(content, section_name) else {
            continue;
        };

        for (package_name, definition) in PHP_DETECTIONS {
            if section_contains_json_key(section, package_name) {
                accumulator.add(
                    &manifest.root_path,
                    definition,
                    "high",
                    format!("composer.json {evidence_label}: {package_name}"),
                );
            }
        }
    }
}

/// Detects Ruby on Rails from Gemfile gem declarations.
fn detect_gemfile(manifest: &ManifestFile, content: &str, accumulator: &mut FrameworkAccumulator) {
    let rails = FrameworkDefinition {
        name: "Rails",
        ecosystem: "ruby",
        category: "fullstack",
    };

    for line in content.lines() {
        if gemfile_line_declares_gem(line, "rails") {
            accumulator.add(
                &manifest.root_path,
                &rails,
                "high",
                "Gemfile gem: rails".to_string(),
            );
        }
    }
}
