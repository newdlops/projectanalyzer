/**
 * Browser-side Canvas renderer source for the graph Webview. The renderer keeps
 * DOM churn at zero during graph redraws and only paints visible scene items.
 */

/**
 * Returns a browser script fragment that defines createGraphCanvasRenderer.
 */
export function getExplorerCanvasRendererSource(): string {
  return /* js */ `
    function createGraphCanvasRenderer(canvas, options) {
      const logicalWidth = Math.max(1, options.width);
      const logicalHeight = Math.max(1, options.height);
      const context = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true
      });
      const rendererState = {
        scene: undefined,
        message: "",
        viewport: { scale: 1, x: 0, y: 0 },
        nodes: [],
        edges: [],
        bounds: undefined,
        frameId: 0,
        lastPixelWidth: 0,
        lastPixelHeight: 0,
        metrics: createDefaultMetrics()
      };

      if (!context) {
        throw new Error("Canvas 2D renderer is unavailable in this Webview.");
      }

      return {
        clearWithMessage,
        drawNow,
        getSceneBounds,
        hitTestNode,
        requestDraw,
        resize,
        screenToCanvas,
        screenToWorld,
        setScene,
        setViewport
      };

      function setScene(scene) {
        rendererState.scene = scene;
        rendererState.message = "";
        rendererState.nodes = scene.nodes.map(createRenderNode);
        rendererState.edges = scene.edges.map(createRenderEdge);
        rendererState.bounds = createSceneBounds(rendererState.nodes, rendererState.edges);
        requestDraw();
      }

      function setViewport(viewport) {
        rendererState.viewport = {
          scale: Math.max(0.01, viewport.scale),
          x: viewport.x,
          y: viewport.y
        };
        requestDraw();
      }

      function clearWithMessage(message) {
        rendererState.scene = undefined;
        rendererState.message = message;
        rendererState.nodes = [];
        rendererState.edges = [];
        rendererState.bounds = undefined;
        requestDraw();
      }

      function requestDraw() {
        if (rendererState.frameId !== 0) {
          return;
        }

        rendererState.frameId = requestAnimationFrame(() => {
          rendererState.frameId = 0;
          drawNow();
        });
      }

      function drawNow() {
        const metrics = resize();
        const theme = readTheme();

        context.save();
        context.setTransform(metrics.pixelRatio, 0, 0, metrics.pixelRatio, 0, 0);
        context.fillStyle = theme.background;
        context.fillRect(0, 0, metrics.cssWidth, metrics.cssHeight);
        context.setTransform(
          metrics.pixelRatio * metrics.worldScale,
          0,
          0,
          metrics.pixelRatio * metrics.worldScale,
          metrics.pixelRatio * metrics.offsetX,
          metrics.pixelRatio * metrics.offsetY
        );

        if (rendererState.message) {
          drawMessage(rendererState.message, theme);
          context.restore();
          return;
        }

        if (!rendererState.scene || rendererState.nodes.length === 0) {
          drawMessage("No graph nodes in this view", theme);
          context.restore();
          return;
        }

        drawScene(theme);
        context.restore();
      }

      function drawScene(theme) {
        const viewport = rendererState.viewport;
        const zoom = Math.max(0.01, viewport.scale);
        const inverseZoom = 1 / zoom;
        const visibleWorld = getVisibleWorldBounds(48 * inverseZoom);

        context.save();
        context.translate(viewport.x, viewport.y);
        context.scale(zoom, zoom);

        for (const edge of rendererState.edges) {
          if (intersectsBounds(edge.bounds, visibleWorld)) {
            drawEdge(edge, theme, inverseZoom);
          }
        }

        for (const node of rendererState.nodes) {
          if (intersectsBounds(node.bounds, visibleWorld)) {
            drawNode(node, theme, inverseZoom, zoom);
          }
        }

        context.restore();
      }

      function drawEdge(edge, theme, inverseZoom) {
        context.save();
        context.globalAlpha = edge.isDimmed ? 0.28 : edge.isSelected ? 0.9 : 0.58;
        context.strokeStyle = edge.isSelected ? theme.selectedEdge : theme.edge;
        context.lineWidth = (edge.isSelected ? 2 : 1.25) * inverseZoom;
        context.setLineDash(edge.confidence === "unresolved" ? [5 * inverseZoom, 4 * inverseZoom] : []);
        context.beginPath();
        context.moveTo(edge.start.x, edge.start.y);
        context.bezierCurveTo(edge.control1.x, edge.control1.y, edge.control2.x, edge.control2.y, edge.end.x, edge.end.y);
        context.stroke();
        drawArrow(edge, theme, inverseZoom);
        context.restore();
      }

      function drawArrow(edge, theme, inverseZoom) {
        const angle = Math.atan2(edge.end.y - edge.control2.y, edge.end.x - edge.control2.x);
        const size = (edge.isSelected ? 7 : 6) * inverseZoom;

        context.save();
        context.translate(edge.end.x, edge.end.y);
        context.rotate(angle);
        context.fillStyle = edge.isSelected ? theme.selectedEdge : theme.edge;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(-size, size * 0.55);
        context.lineTo(-size, -size * 0.55);
        context.closePath();
        context.fill();
        context.restore();
      }

      function drawNode(node, theme, inverseZoom, zoom) {
        const colors = getNodeColors(node, theme);
        const lineWidth = (node.isSelected ? 2.4 : 1.5) * inverseZoom;

        context.save();
        context.globalAlpha = node.isDimmed ? 0.36 : 1;
        context.fillStyle = colors.fill;
        context.strokeStyle = colors.stroke;
        context.lineWidth = lineWidth;
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();

        if (zoom >= 0.42 || node.isSelected) {
          drawNodeLabel(node, theme, inverseZoom);
        }

        context.restore();
      }

      function drawNodeLabel(node, theme, inverseZoom) {
        const fontSize = Math.max(8, Math.min(13, 10 * inverseZoom));
        const labelY = node.y + node.radius + 14 * inverseZoom;

        context.font = fontSize + "px " + theme.fontFamily;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = theme.text;
        context.fillText(node.label, node.x, labelY);
      }

      function drawMessage(message, theme) {
        context.font = "12px " + theme.fontFamily;
        context.fillStyle = theme.mutedText;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(message, logicalWidth / 2, logicalHeight / 2);
      }

      function hitTestNode(screenPoint, viewport) {
        const worldPoint = screenToWorld(screenPoint, viewport || rendererState.viewport);
        const zoom = Math.max(0.01, (viewport || rendererState.viewport).scale);
        const hitPadding = 8 / zoom;

        for (let index = rendererState.nodes.length - 1; index >= 0; index -= 1) {
          const node = rendererState.nodes[index];
          const deltaX = worldPoint.x - node.x;
          const deltaY = worldPoint.y - node.y;
          const hitRadius = node.radius + hitPadding;

          if (deltaX * deltaX + deltaY * deltaY <= hitRadius * hitRadius) {
            return node;
          }
        }

        return undefined;
      }

      function getSceneBounds() {
        return rendererState.bounds;
      }

      function screenToWorld(point, viewport) {
        const activeViewport = viewport || rendererState.viewport;
        const zoom = Math.max(0.01, activeViewport.scale);

        return {
          x: (point.x - activeViewport.x) / zoom,
          y: (point.y - activeViewport.y) / zoom
        };
      }

      function screenToCanvas(point) {
        const metrics = resize();
        const worldScale = Math.max(0.01, metrics.worldScale);

        return {
          x: (point.x - metrics.offsetX) / worldScale,
          y: (point.y - metrics.offsetY) / worldScale
        };
      }

      function resize() {
        const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const cssWidth = Math.max(1, rect.width || logicalWidth);
        const cssHeight = Math.max(1, rect.height || logicalHeight);
        const pixelWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
        const pixelHeight = Math.max(1, Math.round(cssHeight * pixelRatio));

        if (rendererState.lastPixelWidth !== pixelWidth || rendererState.lastPixelHeight !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
          rendererState.lastPixelWidth = pixelWidth;
          rendererState.lastPixelHeight = pixelHeight;
        }

        const fitScale = Math.min(cssWidth / logicalWidth, cssHeight / logicalHeight);

        rendererState.metrics = {
          cssHeight,
          cssWidth,
          offsetX: (cssWidth - logicalWidth * fitScale) / 2,
          offsetY: (cssHeight - logicalHeight * fitScale) / 2,
          pixelRatio,
          worldScale: fitScale
        };

        return rendererState.metrics;
      }

      function createDefaultMetrics() {
        return {
          cssHeight: logicalHeight,
          cssWidth: logicalWidth,
          offsetX: 0,
          offsetY: 0,
          pixelRatio: 1,
          worldScale: 1
        };
      }

      function createRenderNode(node) {
        const labelWidth = Math.min(180, Math.max(48, node.label.length * 6));
        const labelHeight = 20;
        const radius = Math.max(4, node.radius);

        return {
          ...node,
          bounds: {
            bottom: node.y + radius + labelHeight,
            left: node.x - Math.max(radius, labelWidth / 2),
            right: node.x + Math.max(radius, labelWidth / 2),
            top: node.y - radius
          }
        };
      }

      function createRenderEdge(edge) {
        const curve = createEdgeCurve(edge.x1, edge.y1, edge.x2, edge.y2);

        return {
          ...edge,
          ...curve,
          bounds: createCurveBounds(curve)
        };
      }

      function createSceneBounds(nodes, edges) {
        const boundsList = [
          ...nodes.map((node) => node.bounds),
          ...edges.map((edge) => edge.bounds)
        ];

        if (boundsList.length === 0) {
          return undefined;
        }

        return {
          bottom: Math.max(...boundsList.map((bounds) => bounds.bottom)),
          left: Math.min(...boundsList.map((bounds) => bounds.left)),
          right: Math.max(...boundsList.map((bounds) => bounds.right)),
          top: Math.min(...boundsList.map((bounds) => bounds.top))
        };
      }

      function createEdgeCurve(x1, y1, x2, y2) {
        const start = movePointToward(x1, y1, x2, y2, 18);
        const end = movePointToward(x2, y2, x1, y1, 20);
        const deltaX = end.x - start.x;
        const deltaY = end.y - start.y;
        const controlOffset = Math.max(36, Math.abs(deltaX) * 0.42);
        const bend = Math.sign(deltaY || deltaX || 1) * Math.min(42, Math.max(10, Math.abs(deltaY) * 0.18));

        return {
          control1: {
            x: start.x + (deltaX >= 0 ? controlOffset : -controlOffset),
            y: start.y + bend
          },
          control2: {
            x: end.x - (deltaX >= 0 ? controlOffset : -controlOffset),
            y: end.y - bend
          },
          end,
          start
        };
      }

      function createCurveBounds(curve) {
        const xs = [curve.start.x, curve.control1.x, curve.control2.x, curve.end.x];
        const ys = [curve.start.y, curve.control1.y, curve.control2.y, curve.end.y];

        return {
          bottom: Math.max(...ys) + 24,
          left: Math.min(...xs) - 24,
          right: Math.max(...xs) + 24,
          top: Math.min(...ys) - 24
        };
      }

      function getVisibleWorldBounds(padding) {
        const viewport = rendererState.viewport;
        const zoom = Math.max(0.01, viewport.scale);

        return {
          bottom: (logicalHeight - viewport.y) / zoom + padding,
          left: -viewport.x / zoom - padding,
          right: (logicalWidth - viewport.x) / zoom + padding,
          top: -viewport.y / zoom - padding
        };
      }

      function intersectsBounds(left, right) {
        return left.left <= right.right &&
          left.right >= right.left &&
          left.top <= right.bottom &&
          left.bottom >= right.top;
      }

      function movePointToward(x, y, targetX, targetY, distance) {
        const deltaX = targetX - x;
        const deltaY = targetY - y;
        const length = Math.hypot(deltaX, deltaY);

        if (length === 0) {
          return { x, y };
        }

        return {
          x: x + (deltaX / length) * distance,
          y: y + (deltaY / length) * distance
        };
      }

      function getNodeColors(node, theme) {
        if (node.isSelected) {
          return {
            fill: theme.selectedFill,
            stroke: theme.selectedStroke
          };
        }

        if (node.kind === "external") {
          return {
            fill: theme.nodeFill,
            stroke: theme.externalStroke
          };
        }

        if (node.kind === "file" || node.kind === "folder" || node.kind === "workspace") {
          return {
            fill: theme.nodeFill,
            stroke: theme.fileStroke
          };
        }

        return {
          fill: theme.nodeFill,
          stroke: theme.symbolStroke
        };
      }

      function readTheme() {
        const styles = getComputedStyle(document.body);
        const fontFamily = styles.getPropertyValue("--vscode-font-family").trim() || "sans-serif";

        return {
          background: cssVar(styles, "--vscode-editor-background", "#1e1e1e"),
          edge: cssVar(styles, "--vscode-descriptionForeground", "#8f8f8f"),
          externalStroke: cssVar(styles, "--vscode-charts-yellow", "#cca700"),
          fileStroke: cssVar(styles, "--vscode-charts-purple", "#b180d7"),
          fontFamily,
          mutedText: cssVar(styles, "--vscode-descriptionForeground", "#8f8f8f"),
          nodeFill: cssVar(styles, "--vscode-sideBar-background", "#252526"),
          selectedEdge: cssVar(styles, "--vscode-charts-green", "#89d185"),
          selectedFill: cssVar(styles, "--vscode-button-background", "#0e639c"),
          selectedStroke: cssVar(styles, "--vscode-button-foreground", "#ffffff"),
          symbolStroke: cssVar(styles, "--vscode-charts-blue", "#3794ff"),
          text: cssVar(styles, "--vscode-foreground", "#cccccc")
        };
      }

      function cssVar(styles, name, fallback) {
        const value = styles.getPropertyValue(name).trim();

        return value || fallback;
      }
    }
  `;
}
