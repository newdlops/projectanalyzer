//! Unit tests for manifest framework detection.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::{DetectedFramework, ProjectPackageRoot};

use super::{detect_frameworks, detect_frameworks_and_project_package_roots};

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
fn merges_graphql_package_evidence_into_canonical_framework_rows() {
    let workspace = create_temp_workspace("graphql-frameworks");
    write_file(
        &workspace.join("web/package.json"),
        r#"{
          "dependencies": {
            "@nestjs/graphql": "^12.0.0",
            "graphql": "^16.0.0",
            "@apollo/server": "^4.0.0",
            "apollo-server": "^3.0.0"
          }
        }"#,
    );
    write_file(
        &workspace.join("api/requirements.txt"),
        "strawberry-graphql==0.235\ngraphene>=3\n",
    );

    let frameworks = detect_frameworks(&workspace).expect("detects GraphQL frameworks");

    assert_framework(
        &frameworks,
        "GraphQL",
        "javascript",
        "backend",
        "high",
        "web",
    );
    assert_framework(&frameworks, "GraphQL", "python", "backend", "high", "api");
    let javascript = frameworks
        .iter()
        .find(|framework| framework.name == "GraphQL" && framework.ecosystem == "javascript")
        .expect("canonical JavaScript GraphQL row");
    let python = frameworks
        .iter()
        .find(|framework| framework.name == "GraphQL" && framework.ecosystem == "python")
        .expect("canonical Python GraphQL row");
    assert_eq!(javascript.evidence.len(), 4);
    assert_eq!(python.evidence.len(), 2);

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

#[test]
fn merges_project_package_manifest_evidence_by_root_deterministically() {
    let workspace = create_temp_workspace("project-package-roots");
    // Deliberately create manifests out of lexical order. The iterative scanner
    // and set-backed merge must still emit stable roots, paths, and ecosystems.
    write_file(&workspace.join("api/requirements.txt"), "fastapi==0.111\n");
    write_file(&workspace.join("package.json"), r#"{"private":true}"#);
    write_file(
        &workspace.join("api/Cargo.toml"),
        "[package]\nname = \"api-sidecar\"\nversion = \"0.1.0\"\n",
    );
    write_file(
        &workspace.join("api/pyproject.toml"),
        "[project]\nname = \"api\"\n",
    );
    write_file(
        &workspace.join("workers/go.mod"),
        "module example.com/workers\n",
    );
    write_file(
        &workspace.join("node_modules/ignored/package.json"),
        r#"{"dependencies":{"react":"18"}}"#,
    );

    let detection = detect_frameworks_and_project_package_roots(&workspace)
        .expect("detects frameworks and package roots");
    let roots = detection.project_package_roots;

    assert_eq!(
        roots
            .iter()
            .map(|root| root.root_path.as_str())
            .collect::<Vec<_>>(),
        vec![".", "api", "workers"]
    );
    assert_package_root(&roots, ".", &["package.json"], &["javascript"]);
    assert_package_root(
        &roots,
        "api",
        &[
            "api/Cargo.toml",
            "api/pyproject.toml",
            "api/requirements.txt",
        ],
        &["python", "rust"],
    );
    assert_package_root(&roots, "workers", &["workers/go.mod"], &["go"]);

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

/// Verifies one deterministic neutral package-root record by exact root label.
fn assert_package_root(
    roots: &[ProjectPackageRoot],
    root_path: &str,
    manifest_paths: &[&str],
    ecosystems: &[&str],
) {
    let root = roots
        .iter()
        .find(|root| root.root_path == root_path)
        .unwrap_or_else(|| panic!("missing project package root at {root_path}"));
    assert_eq!(
        root.manifest_paths,
        manifest_paths
            .iter()
            .map(|path| path.to_string())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        root.ecosystems,
        ecosystems
            .iter()
            .map(|ecosystem| ecosystem.to_string())
            .collect::<Vec<_>>()
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
