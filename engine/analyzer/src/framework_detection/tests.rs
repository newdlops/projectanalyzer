//! Unit tests for manifest framework detection.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::DetectedFramework;

use super::detect_frameworks;

#[test]
fn detects_javascript_frameworks_from_package_json() {
    let workspace = create_temp_workspace("js-frameworks");
    write_file(
        &workspace.join("package.json"),
        r#"{
          "scripts": {
            "dev": "vite --host",
            "test": "vitest run"
          },
          "dependencies": {
            "react": "^18.0.0",
            "next": "14.0.0",
            "express": "^4.0.0"
          },
          "devDependencies": {
            "@nestjs/core": "^10.0.0",
            "jest": "^29.0.0"
          }
        }"#,
    );

    let frameworks = detect_frameworks(&workspace).expect("detects frameworks");

    assert_framework(&frameworks, "React", "javascript", "frontend", "high", ".");
    assert_framework(
        &frameworks,
        "Next.js",
        "javascript",
        "fullstack",
        "high",
        ".",
    );
    assert_framework(&frameworks, "Express", "javascript", "backend", "high", ".");
    assert_framework(&frameworks, "NestJS", "javascript", "backend", "high", ".");
    assert_framework(&frameworks, "Jest", "javascript", "test", "high", ".");
    assert_framework(&frameworks, "Vitest", "javascript", "test", "medium", ".");
    assert_framework(&frameworks, "Vite", "javascript", "build", "medium", ".");

    remove_temp_workspace(&workspace);
}

#[test]
fn detects_frameworks_across_manifest_ecosystems() {
    let workspace = create_temp_workspace("all-frameworks");
    write_file(
        &workspace.join("api/requirements.txt"),
        "Django>=4\npytest==8\n",
    );
    write_file(
        &workspace.join("engine/Cargo.toml"),
        "[package]\nname = \"demo\"\n[dependencies]\naxum = \"0.7\"\ntauri = \"1\"\n",
    );
    write_file(
        &workspace.join("go/go.mod"),
        "module example.com/demo\nrequire (\n github.com/gin-gonic/gin v1.9.0\n github.com/labstack/echo/v4 v4.11.0\n github.com/gofiber/fiber/v2 v2.50.0\n)\n",
    );
    write_file(
        &workspace.join("jvm/build.gradle.kts"),
        "plugins { id(\"org.springframework.boot\") version \"3.3.0\" }\ndependencies { implementation(\"org.springframework.boot:spring-boot-starter-web\") }\n",
    );
    write_file(
        &workspace.join("php/composer.json"),
        r#"{"require":{"laravel/framework":"^11","symfony/framework-bundle":"^7"}}"#,
    );
    write_file(
        &workspace.join("ruby/Gemfile"),
        "source 'https://rubygems.org'\ngem 'rails'\n",
    );

    let frameworks = detect_frameworks(&workspace).expect("detects frameworks");

    assert_framework(&frameworks, "Django", "python", "backend", "high", "api");
    assert_framework(&frameworks, "pytest", "python", "test", "high", "api");
    assert_framework(&frameworks, "Axum", "rust", "backend", "high", "engine");
    assert_framework(&frameworks, "Tauri", "rust", "desktop", "high", "engine");
    assert_framework(&frameworks, "Gin", "go", "backend", "high", "go");
    assert_framework(&frameworks, "Echo", "go", "backend", "high", "go");
    assert_framework(&frameworks, "Fiber", "go", "backend", "high", "go");
    assert_framework(&frameworks, "Spring Boot", "jvm", "backend", "high", "jvm");
    assert_framework(&frameworks, "Laravel", "php", "backend", "high", "php");
    assert_framework(&frameworks, "Symfony", "php", "backend", "high", "php");
    assert_framework(&frameworks, "Rails", "ruby", "fullstack", "high", "ruby");

    remove_temp_workspace(&workspace);
}

#[test]
fn detects_multiple_django_project_roots_from_manage_py_entrypoints() {
    let workspace = create_temp_workspace("django-monorepo");
    write_file(
        &workspace.join("requirements.txt"),
        "Django>=4\npytest==8\n",
    );
    write_file(
        &workspace.join("services/admin/manage.py"),
        &django_manage_py("admin.settings"),
    );
    write_file(
        &workspace.join("services/api/manage.py"),
        &django_manage_py("api.settings"),
    );

    let frameworks = detect_frameworks(&workspace).expect("detects frameworks");

    assert_framework(
        &frameworks,
        "Django",
        "python",
        "backend",
        "high",
        "services/admin",
    );
    assert_framework(
        &frameworks,
        "Django",
        "python",
        "backend",
        "high",
        "services/api",
    );
    assert_no_framework(&frameworks, "Django", "python", ".");
    assert_framework(&frameworks, "pytest", "python", "test", "high", ".");

    remove_temp_workspace(&workspace);
}

#[test]
fn ignores_manifests_inside_excluded_directories() {
    let workspace = create_temp_workspace("excluded-frameworks");
    write_file(
        &workspace.join("node_modules/app/package.json"),
        r#"{"dependencies":{"next":"14.0.0"}}"#,
    );

    let frameworks = detect_frameworks(&workspace).expect("detects frameworks");

    assert!(frameworks.is_empty());
    remove_temp_workspace(&workspace);
}

fn assert_framework(
    frameworks: &[DetectedFramework],
    name: &str,
    ecosystem: &str,
    category: &str,
    confidence: &str,
    root_path: &str,
) {
    let framework = frameworks
        .iter()
        .find(|framework| {
            framework.name == name
                && framework.ecosystem == ecosystem
                && framework.root_path.as_deref() == Some(root_path)
        })
        .unwrap_or_else(|| panic!("missing framework {ecosystem}/{name} at {root_path}"));

    assert_eq!(framework.category, category);
    assert_eq!(framework.confidence, confidence);
    assert!(
        !framework.evidence.is_empty(),
        "framework {ecosystem}/{name} should include evidence"
    );
}

fn assert_no_framework(
    frameworks: &[DetectedFramework],
    name: &str,
    ecosystem: &str,
    root_path: &str,
) {
    assert!(
        !frameworks.iter().any(|framework| {
            framework.name == name
                && framework.ecosystem == ecosystem
                && framework.root_path.as_deref() == Some(root_path)
        }),
        "unexpected framework {ecosystem}/{name} at {root_path}"
    );
}

fn django_manage_py(settings_module: &str) -> String {
    format!(
        "import os\nfrom django.core.management import execute_from_command_line\nos.environ.setdefault('DJANGO_SETTINGS_MODULE', '{settings_module}')\nexecute_from_command_line()\n"
    )
}

fn create_temp_workspace(label: &str) -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after epoch")
        .as_millis();
    let workspace = std::env::temp_dir().join(format!(
        "project-analyzer-{label}-{}-{millis}",
        std::process::id()
    ));
    fs::create_dir_all(&workspace).expect("creates temp workspace");
    workspace
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("creates parent directory");
    }
    fs::write(path, content).expect("writes test manifest");
}

fn remove_temp_workspace(workspace: &Path) {
    fs::remove_dir_all(workspace).expect("removes temp workspace");
}
