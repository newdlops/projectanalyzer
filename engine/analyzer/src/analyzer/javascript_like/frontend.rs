//! Syntax frontend contract for JavaScript-like analyzers.
//!
//! The types in this module are the boundary between parser frontends and graph
//! extraction. The current frontend is conservative and line based, but AST
//! adapters such as tree-sitter, swc, or oxc should be able to populate the
//! same facts without changing call resolution or graph construction.

#![allow(dead_code)]

use crate::model::{SourceInput, SourceRange};

/// Parses a source file into syntax facts consumed by the graph layer.
pub(super) trait SyntaxFrontend {
    /// Builds parser-independent syntax facts for one JavaScript-like file.
    fn parse(&self, file: &SourceInput) -> Result<ParsedModule, String>;
}

/// Parser-independent facts collected from one module.
#[derive(Default)]
pub(super) struct ParsedModule {
    /// Declarations emitted in lexical source order; parent indexes point into this vector.
    pub(super) declarations: Vec<SyntaxDeclaration>,
    /// Function or method calls associated with a declaration index.
    pub(super) calls: Vec<SyntaxCall>,
    /// Import facts staged for a later import/export resolution pass.
    pub(super) imports: Vec<SyntaxImport>,
    /// Export facts staged for a later import/export resolution pass.
    pub(super) exports: Vec<SyntaxExport>,
}

impl ParsedModule {
    /// Creates an empty module fact container for a parser frontend.
    pub(super) fn new() -> Self {
        Self::default()
    }
}

/// A declaration that should become a graph symbol.
#[derive(Clone)]
pub(super) struct SyntaxDeclaration {
    /// Graph-facing symbol kind preserved without exposing raw parser details.
    pub(super) kind: SyntaxSymbolKind,
    /// Unqualified symbol name as written in source.
    pub(super) name: String,
    /// Lexical name chain from the module root to this declaration.
    pub(super) scope_names: Vec<String>,
    /// Declaration index of the containing symbol, or `None` for file-level symbols.
    pub(super) parent_index: Option<usize>,
    /// Full declaration range reported by the frontend.
    pub(super) range: SourceRange,
    /// Identifier range used for editor selection.
    pub(super) selection_range: SourceRange,
}

impl SyntaxDeclaration {
    /// Returns the dot-qualified same-file symbol name used for local resolution.
    pub(super) fn qualified_name(&self) -> String {
        self.scope_names.join(".")
    }
}

/// Symbol kinds supported by the JavaScript-like parser boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SyntaxSymbolKind {
    Class,
    Interface,
    Enum,
    Function,
    Method,
    Constructor,
}

impl SyntaxSymbolKind {
    /// Returns the serialized graph kind for this syntax symbol.
    pub(super) fn graph_kind(self) -> &'static str {
        match self {
            Self::Class => "class",
            Self::Interface => "interface",
            Self::Enum => "enum",
            Self::Function => "function",
            Self::Method => "method",
            Self::Constructor => "constructor",
        }
    }

    /// Returns whether this declaration can own or receive call edges.
    pub(super) fn is_callable(self) -> bool {
        matches!(self, Self::Function | Self::Method | Self::Constructor)
    }
}

/// A call expression attached to a callable declaration.
#[derive(Clone)]
pub(super) struct SyntaxCall {
    /// Declaration index of the caller that lexically owns this call.
    pub(super) source_declaration_index: usize,
    /// Parser-independent callee information used by call resolution.
    pub(super) expression: CallExpression,
}

/// Callee information for one call expression.
#[derive(Clone)]
pub(super) struct CallExpression {
    /// Name shown for unresolved external targets, including member qualifiers when present.
    pub(super) display_name: String,
    /// Final identifier segment used for bare and `this.member` lookup.
    pub(super) lookup_name: String,
    /// Optional member qualifier such as `this` or `Service`.
    pub(super) qualifier: Option<String>,
    /// Source range covering the callee chain and opening parenthesis.
    pub(super) range: SourceRange,
}

/// Import statement shape collected before module resolution is implemented.
#[derive(Clone)]
pub(super) struct SyntaxImport {
    /// Import syntax family; consumers can decide how to resolve each family later.
    pub(super) kind: SyntaxImportKind,
    /// Raw module specifier without quotes, scoped to the current source file.
    pub(super) module_specifier: String,
    /// Local bindings introduced by the import statement.
    pub(super) bindings: Vec<SyntaxImportBinding>,
    /// Source range for diagnostics or future import edges.
    pub(super) range: SourceRange,
}

/// Import syntax families supported by the current boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SyntaxImportKind {
    EsModule,
    CommonJsRequire,
}

/// One local binding introduced by an import statement.
#[derive(Clone)]
pub(super) struct SyntaxImportBinding {
    /// How the local binding was introduced.
    pub(super) kind: SyntaxImportBindingKind,
    /// Local symbol name available inside this file.
    pub(super) local_name: String,
    /// Imported export name when the syntax names one explicitly.
    pub(super) imported_name: Option<String>,
}

/// Import binding forms preserved for future resolution.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SyntaxImportBindingKind {
    Default,
    Named,
    Namespace,
    CommonJs,
}

/// Export statement shape collected before module resolution is implemented.
#[derive(Clone)]
pub(super) struct SyntaxExport {
    /// Export syntax family; consumers can decide how to resolve each family later.
    pub(super) kind: SyntaxExportKind,
    /// Names exported by this statement.
    pub(super) bindings: Vec<SyntaxExportBinding>,
    /// Re-export source module when the statement names one.
    pub(super) module_specifier: Option<String>,
    /// Source range for diagnostics or future export edges.
    pub(super) range: SourceRange,
}

/// Export syntax families supported by the current boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SyntaxExportKind {
    Declaration,
    Default,
    Named,
    All,
    CommonJs,
}

/// One name exported by an export statement.
#[derive(Clone)]
pub(super) struct SyntaxExportBinding {
    /// Name visible to importers of this module.
    pub(super) exported_name: String,
    /// Local name that backs the export, when different from the exported name.
    pub(super) local_name: Option<String>,
}
