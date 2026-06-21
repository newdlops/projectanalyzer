//! Tests for framework semantic unit extraction.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::framework_detection::detect_frameworks;
use crate::graph::ProjectGraphBuilder;
use crate::model::FrameworkUnit;

use super::analyze_framework_units;

#[test]
fn extracts_django_units_edges_and_json_fields() {
    let workspace = create_temp_workspace("django-framework-units");
    write_django_fixture(&workspace);

    let frameworks = detect_frameworks(&workspace).expect("detects Django");
    let extraction =
        analyze_framework_units(&workspace, &frameworks).expect("extracts framework units");

    assert!(extraction
        .units
        .iter()
        .any(|unit| unit.kind == "app" && unit.name == "blog"));
    assert_unit_kind(&extraction.units, "configuration");
    assert_unit_kind(&extraction.units, "route");
    assert_unit_kind(&extraction.units, "model");
    assert_unit_kind(&extraction.units, "view");
    assert_unit_kind(&extraction.units, "serializer");
    assert_unit_kind(&extraction.units, "command");

    let blog_app = find_unit(&extraction.units, "app", "blog");
    let blog_children = [
        find_unit(&extraction.units, "configuration", "BlogConfig"),
        find_unit(&extraction.units, "model", "Post"),
        find_unit(&extraction.units, "view", "feed"),
        find_unit(&extraction.units, "serializer", "PostSerializer"),
        find_unit(&extraction.units, "command", "reindex"),
    ];

    for child in blog_children {
        assert_eq!(child.parent_id.as_deref(), Some(blog_app.id.as_str()));
        assert!(extraction.edges.iter().any(|edge| {
            edge.kind == "contains" && edge.source_id == blog_app.id && edge.target_id == child.id
        }));
    }

    let site_app = find_unit(&extraction.units, "app", "mysite");
    let include_route = find_unit(&extraction.units, "route", "blog/ (blog)");
    let feed_route = find_unit(&extraction.units, "route", "posts/ (post-feed)");
    let detail_route = find_unit(&extraction.units, "route", "posts/<int:pk>/ (post-detail)");
    let feed_view = find_unit(&extraction.units, "view", "feed");
    let detail_view = find_unit(&extraction.units, "view", "PostDetailView");
    let timestamped_model = find_unit(&extraction.units, "model", "TimestampedModel");
    let published_model = find_unit(&extraction.units, "model", "PublishedModel");
    let post_model = find_unit(&extraction.units, "model", "Post");
    let audit_log_model = find_unit(&extraction.units, "model", "AuditLog");
    let post_serializer = find_unit(&extraction.units, "serializer", "PostSerializer");
    let site_settings = find_unit(&extraction.units, "configuration", "settings");
    assert_eq!(feed_route.parent_id.as_deref(), Some(site_app.id.as_str()));
    assert_eq!(
        include_route.parent_id.as_deref(),
        Some(site_app.id.as_str())
    );
    assert_eq!(
        detail_route.parent_id.as_deref(),
        Some(site_app.id.as_str())
    );
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "routesTo" && edge.source_id == feed_route.id && edge.target_id == feed_view.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "routesTo"
            && edge.source_id == detail_route.id
            && edge.target_id == detail_view.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "usesModel"
            && edge.source_id == post_serializer.id
            && edge.target_id == post_model.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "extends"
            && edge.source_id == published_model.id
            && edge.target_id == timestamped_model.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "extends"
            && edge.source_id == post_model.id
            && edge.target_id == published_model.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "extends"
            && edge.source_id == audit_log_model.id
            && edge.target_id == timestamped_model.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "usesModel"
            && edge.source_id == feed_view.id
            && edge.target_id == post_model.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "renders"
            && edge.source_id == feed_view.id
            && edge.target_id == post_serializer.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "configures"
            && edge.source_id == site_settings.id
            && edge.target_id == blog_app.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "configures"
            && edge.source_id == include_route.id
            && edge.target_id == blog_app.id
    }));

    let mut builder = ProjectGraphBuilder::new(workspace.clone());
    builder.add_framework_units(extraction.units.clone(), extraction.edges.clone());
    let json = builder.finish().to_json();
    let metadata_index = json.find("\"metadata\":{").expect("serializes metadata");
    let units_index = json
        .find("\"frameworkUnits\":[")
        .expect("serializes framework units");
    let edges_index = json
        .find("\"frameworkUnitEdges\":[")
        .expect("serializes framework unit edges");
    let file_count_index = json.find("\"fileCount\":").expect("serializes file count");

    assert!(metadata_index < units_index);
    assert!(units_index < edges_index);
    assert!(edges_index < file_count_index);
    assert!(json.contains("\"rootPath\":\".\""));
    assert!(json.contains("\"filePath\":"));
    assert!(json.contains("\"parentId\":"));
    assert!(json.contains("\"sourceId\":"));
    assert!(json.contains("\"targetId\":"));

    remove_temp_workspace(&workspace);
}

#[test]
fn extracts_fastapi_units_and_route_controller_edges() {
    let workspace = create_temp_workspace("fastapi-framework-units");
    write_fastapi_fixture(&workspace);

    let frameworks = detect_frameworks(&workspace).expect("detects FastAPI");
    let extraction =
        analyze_framework_units(&workspace, &frameworks).expect("extracts FastAPI units");

    assert!(extraction
        .units
        .iter()
        .any(|unit| unit.kind == "module" && unit.name == "main"));
    let app = find_unit(&extraction.units, "app", "app");
    let route = find_unit(&extraction.units, "route", "GET /items/{item_id}");
    let controller = find_unit(&extraction.units, "controller", "read_item");
    let schema = find_unit(&extraction.units, "schema", "Item");
    let dependency = find_unit(&extraction.units, "dependency", "auth_user");

    for child in [app, route, controller, schema, dependency] {
        assert!(
            child.parent_id.is_some(),
            "{} unit should be contained by a module",
            child.kind
        );
    }
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "routesTo" && edge.source_id == route.id && edge.target_id == controller.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "usesModel" && edge.source_id == route.id && edge.target_id == schema.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "injects" && edge.source_id == controller.id && edge.target_id == dependency.id
    }));

    remove_temp_workspace(&workspace);
}

#[test]
fn extracts_nextjs_frontend_units_and_render_edges() {
    let workspace = create_temp_workspace("nextjs-framework-units");
    write_nextjs_fixture(&workspace);

    let frameworks = detect_frameworks(&workspace).expect("detects Next.js");
    let extraction =
        analyze_framework_units(&workspace, &frameworks).expect("extracts Next.js units");

    let module = find_unit(&extraction.units, "module", "app.dashboard.page");
    let route = find_unit(&extraction.units, "route", "route /dashboard");
    let component = find_unit(&extraction.units, "component", "DashboardPage");
    let card = find_unit(&extraction.units, "component", "UserCard");
    let provider = find_unit(&extraction.units, "provider", "ThemeProvider");
    let hook = find_unit(&extraction.units, "service", "useDashboardData");

    for child in [route, component, card, provider, hook] {
        assert_eq!(child.parent_id.as_deref(), Some(module.id.as_str()));
    }
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "renders" && edge.source_id == route.id && edge.target_id == component.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "renders" && edge.source_id == component.id && edge.target_id == card.id
    }));

    remove_temp_workspace(&workspace);
}

#[test]
fn extracts_flask_units_and_route_controller_edges() {
    let workspace = create_temp_workspace("flask-framework-units");
    write_flask_fixture(&workspace);

    let frameworks = detect_frameworks(&workspace).expect("detects Flask");
    let extraction =
        analyze_framework_units(&workspace, &frameworks).expect("extracts Flask units");

    let module = find_unit(&extraction.units, "module", "app");
    let app = find_unit(&extraction.units, "app", "app");
    let blueprint = find_unit(&extraction.units, "module", "api");
    let route = find_unit(&extraction.units, "route", "ROUTE /users/<id>");
    let controller = find_unit(&extraction.units, "controller", "show_user");
    let middleware = find_unit(&extraction.units, "middleware", "before_request load_user");

    for child in [app, blueprint, route, controller, middleware] {
        assert_eq!(child.parent_id.as_deref(), Some(module.id.as_str()));
    }
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "routesTo" && edge.source_id == route.id && edge.target_id == controller.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "configures" && edge.source_id == app.id && edge.target_id == blueprint.id
    }));

    remove_temp_workspace(&workspace);
}

#[test]
fn extracts_express_units_and_route_controller_edges() {
    let workspace = create_temp_workspace("express-framework-units");
    write_express_fixture(&workspace);

    let frameworks = detect_frameworks(&workspace).expect("detects Express");
    let extraction =
        analyze_framework_units(&workspace, &frameworks).expect("extracts Express units");

    let module = find_unit(&extraction.units, "module", "server");
    let route = find_unit(&extraction.units, "route", "GET /users/:id");
    let controller = find_unit(&extraction.units, "controller", "showUser");
    let middleware = find_unit(&extraction.units, "middleware", "authMiddleware");

    for child in [route, controller, middleware] {
        assert_eq!(child.parent_id.as_deref(), Some(module.id.as_str()));
    }
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "routesTo" && edge.source_id == route.id && edge.target_id == controller.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "calls" && edge.source_id == route.id && edge.target_id == middleware.id
    }));

    remove_temp_workspace(&workspace);
}

#[test]
fn extracts_nestjs_units_and_controller_route_edges() {
    let workspace = create_temp_workspace("nestjs-framework-units");
    write_nestjs_fixture(&workspace);

    let frameworks = detect_frameworks(&workspace).expect("detects NestJS");
    let extraction = analyze_framework_units(&workspace, &frameworks).expect("extracts Nest units");

    let module = find_unit(&extraction.units, "module", "users.controller");
    let controller = find_unit(&extraction.units, "controller", "UsersController");
    let route = find_unit(&extraction.units, "route", "GET /users/:id");
    let service = find_unit(&extraction.units, "service", "UsersService");

    for child in [controller, route, service] {
        assert_eq!(child.parent_id.as_deref(), Some(module.id.as_str()));
    }
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "contains" && edge.source_id == controller.id && edge.target_id == route.id
    }));
    assert!(extraction.edges.iter().any(|edge| {
        edge.kind == "injects" && edge.source_id == controller.id && edge.target_id == service.id
    }));

    remove_temp_workspace(&workspace);
}

fn assert_unit_kind(units: &[FrameworkUnit], kind: &str) {
    assert!(
        units.iter().any(|unit| unit.kind == kind),
        "missing unit kind {kind}"
    );
}

fn find_unit<'a>(units: &'a [FrameworkUnit], kind: &str, name: &str) -> &'a FrameworkUnit {
    units
        .iter()
        .find(|unit| unit.kind == kind && unit.name == name)
        .unwrap_or_else(|| panic!("missing {kind} unit named {name}"))
}

fn write_django_fixture(workspace: &Path) {
    write_file(&workspace.join("requirements.txt"), "Django>=4\n");
    write_file(
        &workspace.join("mysite/settings.py"),
        "INSTALLED_APPS = [\"blog\"]\nROOT_URLCONF = \"mysite.urls\"\n",
    );
    write_file(
        &workspace.join("mysite/urls.py"),
        "from django.urls import include, path\nfrom blog import views\n\nurlpatterns = [\n    path(\"blog/\", include(\"blog.urls\"), name=\"blog\"),\n    path(\"posts/\", views.feed, name=\"post-feed\"),\n    path(\n        \"posts/<int:pk>/\",\n        views.PostDetailView.as_view(),\n        name=\"post-detail\",\n    ),\n]\n",
    );
    write_file(
        &workspace.join("blog/urls.py"),
        "from django.urls import path\n\nurlpatterns = []\n",
    );
    write_file(
        &workspace.join("blog/apps.py"),
        "from django.apps import AppConfig\n\nclass BlogConfig(AppConfig):\n    name = \"blog\"\n",
    );
    write_file(
        &workspace.join("blog/models.py"),
        "from django.db import models\n\nclass TimestampedModel(models.Model):\n    created_at = models.DateTimeField()\n\n    class Meta:\n        abstract = True\n\nclass PublishedModel(\n    TimestampedModel,\n):\n    class Meta:\n        abstract = True\n\nclass Post(PublishedModel):\n    pass\n",
    );
    write_file(
        &workspace.join("blog/models/audit.py"),
        "from blog.models import TimestampedModel\n\nclass AuditLog(TimestampedModel):\n    pass\n",
    );
    write_file(
        &workspace.join("blog/views.py"),
        "from .models import Post\nfrom .serializers import PostSerializer\n\nasync def feed(request):\n    posts = Post.objects.all()\n    return PostSerializer(posts, many=True)\n\nclass PostDetailView:\n    pass\n",
    );
    write_file(
        &workspace.join("blog/serializers.py"),
        "from rest_framework import serializers\nfrom .models import Post\n\nclass PostSerializer(serializers.ModelSerializer):\n    class Meta:\n        model = Post\n        fields = [\"id\"]\n",
    );
    write_file(
        &workspace.join("blog/management/commands/reindex.py"),
        "from django.core.management.base import BaseCommand\n\nclass Command(BaseCommand):\n    def handle(self, *args, **options):\n        pass\n",
    );
}

fn write_fastapi_fixture(workspace: &Path) {
    write_file(
        &workspace.join("requirements.txt"),
        "fastapi==0.111\npydantic>=2\n",
    );
    write_file(
        &workspace.join("main.py"),
        "from fastapi import Depends, FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass Item(BaseModel):\n    name: str\n\ndef auth_user():\n    return \"user\"\n\n@app.get(\"/items/{item_id}\", response_model=Item)\nasync def read_item(item_id: int, user=Depends(auth_user)):\n    return {\"item_id\": item_id}\n",
    );
}

fn write_nextjs_fixture(workspace: &Path) {
    write_file(
        &workspace.join("package.json"),
        r#"{"dependencies":{"next":"14.0.0"}}"#,
    );
    write_file(
        &workspace.join("app/dashboard/page.tsx"),
        "export default function DashboardPage() {\n  return <UserCard />;\n}\n\nexport function UserCard() {\n  return <main />;\n}\n\nexport const ThemeProvider = ({ children }) => children;\n\nexport function useDashboardData() {\n  return [];\n}\n",
    );
}

fn write_flask_fixture(workspace: &Path) {
    write_file(&workspace.join("requirements.txt"), "Flask==3.0\n");
    write_file(
        &workspace.join("app.py"),
        "from flask import Blueprint, Flask\n\napp = Flask(__name__)\napi = Blueprint(\"api\", __name__)\n\n@app.before_request\ndef load_user():\n    pass\n\n@api.route(\"/users/<id>\")\ndef show_user(id):\n    return id\n\napp.register_blueprint(api, url_prefix=\"/api\")\n",
    );
}

fn write_express_fixture(workspace: &Path) {
    write_file(
        &workspace.join("package.json"),
        r#"{"dependencies":{"express":"^4.18.0"}}"#,
    );
    write_file(
        &workspace.join("server.ts"),
        "import express from \"express\";\nconst app = express();\nfunction authMiddleware(req, res, next) { next(); }\nfunction showUser(req, res) { res.json({ id: req.params.id }); }\napp.use(authMiddleware);\napp.get(\"/users/:id\", authMiddleware, showUser);\n",
    );
}

fn write_nestjs_fixture(workspace: &Path) {
    write_file(
        &workspace.join("package.json"),
        r#"{"dependencies":{"@nestjs/core":"^10.0.0"}}"#,
    );
    write_file(
        &workspace.join("users.controller.ts"),
        "import { Controller, Get, Injectable } from \"@nestjs/common\";\n\n@Controller(\"users\")\nexport class UsersController {\n  constructor(private readonly usersService: UsersService) {}\n\n  @Get(\":id\")\n  findOne() {\n    return this.usersService.findOne();\n  }\n}\n\n@Injectable()\nexport class UsersService {\n  findOne() { return {}; }\n}\n",
    );
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
    fs::write(path, content).expect("writes fixture file");
}

fn remove_temp_workspace(workspace: &Path) {
    fs::remove_dir_all(workspace).expect("removes temp workspace");
}
