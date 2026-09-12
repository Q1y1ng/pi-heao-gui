/**
 * Dark theme CSS overrides injected into pi-chat HTML.
 * Defines VS Code CSS variables that pi-chat expects but Electron doesn't provide.
 */
export const THEME_CSS = `
<style id="pi-standalone-theme">
/* Electron titleBarStyle: hidden — make existing bars draggable */
.toolbar { -webkit-app-region: drag; }
.toolbar button, .toolbar .icon-btn, .toolbar select, .toolbar input { -webkit-app-region: no-drag; }
/* Sidebar header draggable */
#pi-sidebar > div:first-child { -webkit-app-region: drag; }
#pi-sidebar > div:first-child button { -webkit-app-region: no-drag; }
/* Collapsed sidebar strip draggable */
#pi-sidebar-collapsed { -webkit-app-region: drag; }
#pi-sidebar-collapsed button { -webkit-app-region: no-drag; }

:root {
  /* VS Code Dark+ palette */
  --vscode-editor-background: #1e1e1e;
  --vscode-editor-foreground: #d4d4d4;
  --vscode-foreground: #cccccc;
  --vscode-descriptionForeground: #999999;
  --vscode-widget-border: #3c3c3c;
  --vscode-panel-border: #3c3c3c;
  --vscode-input-background: #3c3c3c;
  --vscode-input-foreground: #cccccc;
  --vscode-input-border: #3c3c3c;
  --vscode-input-placeholderForeground: #888888;
  --vscode-button-background: #0e639c;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #1177bb;
  --vscode-button-secondaryBackground: #3a3d41;
  --vscode-button-secondaryForeground: #cccccc;
  --vscode-dropdown-background: #3c3c3c;
  --vscode-dropdown-foreground: #cccccc;
  --vscode-dropdown-border: #3c3c3c;
  --vscode-list-hoverBackground: #2a2d2e;
  --vscode-list-activeSelectionBackground: #094771;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-badge-background: #4d4d4d;
  --vscode-badge-foreground: #ffffff;
  --vscode-scrollbarSlider-background: #79797966;
  --vscode-scrollbarSlider-hoverBackground: #646464b3;
  --vscode-focusBorder: #007fd4;
  --vscode-errorForeground: #f44747;
  --vscode-warningForeground: #cca700;
  --vscode-terminal-foreground: #cccccc;
  --vscode-terminal-background: #1e1e1e;
  --vscode-font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --vscode-font-size: 13px;
  /* Accent */
  --vscode-textLink-foreground: #3794ff;
  --vscode-textLink-activeForeground: #3794ff;
  --vscode-editorWidget-background: #252526;
  --vscode-editorWidget-foreground: #cccccc;
  --vscode-editorWidget-border: #454545;
  --vscode-menu-background: #252526;
  --vscode-menu-foreground: #cccccc;
  --vscode-menu-selectionBackground: #094771;
  --vscode-menu-selectionForeground: #ffffff;
  --vscode-peekViewEditor-background: #000000;
  --vscode-peekViewResult-background: #252526;
  --vscode-sideBar-background: #252526;
  --vscode-sideBar-foreground: #cccccc;
  --vscode-sideBar-border: #3c3c3c;
  --vscode-activityBar-background: #333333;
  --vscode-activityBar-foreground: #ffffff;
  --vscode-titleBar-activeBackground: #3c3c3c;
  --vscode-titleBar-activeForeground: #cccccc;
  --vscode-statusBar-background: #007acc;
  --vscode-statusBar-foreground: #ffffff;
  --vscode-tab-activeBackground: #1e1e1e;
  --vscode-tab-inactiveBackground: #2d2d2d;
  --vscode-tab-activeForeground: #ffffff;
  --vscode-tab-inactiveForeground: #888888;
}
/* Force high-contrast text everywhere */
body, .app, .messages, .messages-inner {
  color: #d4d4d4 !important;
  background: #1e1e1e !important;
}
.empty, .empty-line, .empty-hint {
  color: #b0b0b0 !important;
}
.empty-accent {
  color: #3794ff !important;
}
kbd {
  background: #3c3c3c !important;
  color: #e0e0e0 !important;
  border: 1px solid #555 !important;
}
/* Composer */
.composer-input, .composer-box {
  color: #d4d4d4 !important;
}
.composer-input:empty::before {
  color: #888 !important;
}
/* Message bubbles */
.msg-user, .msg-assistant {
  color: #d4d4d4 !important;
}
/* Code blocks */
pre, code {
  color: #d4d4d4 !important;
  background: #2d2d2d !important;
}
/* Links */
a {
  color: #3794ff !important;
}
/* Toolbar */
.toolbar {
  background: #2d2d2d !important;
  border-bottom-color: #3c3c3c !important;
  color: #cccccc !important;
}
.toolbar .status, .toolbar .session-info {
  color: #aaaaaa !important;
}
/* Model picker */
.model-trigger, .model-popup, .model-search, .model-list {
  color: #d4d4d4 !important;
}
.model-popup {
  background: #252526 !important;
  border-color: #454545 !important;
}
/* Select dropdowns */
select, .select-borderless {
  color: #d4d4d4 !important;
  background: transparent !important;
}
select option {
  background: #252526 !important;
  color: #d4d4d4 !important;
}
/* Scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: #1e1e1e; }
::-webkit-scrollbar-thumb { background: #4a4a4a; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #5a5a5a; }
/* Toast */
.toast {
  color: #e0e0e0 !important;
  background: #333 !important;
  border: 1px solid #555 !important;
}
/* Widget */
.widget, .widget-card {
  background: #252526 !important;
  border-color: #3c3c3c !important;
  color: #d4d4d4 !important;
}
/* Queue */
.queue-item {
  background: #2a2d2e !important;
  color: #d4d4d4 !important;
}
/* Timeline rail */
.timeline-rail {
  color: #666 !important;
}
/* Context ring */
.ctx-ring-track { stroke: #3c3c3c !important; }
.ctx-ring-prog { stroke: #007acc !important; }
/* Autocomplete */
.autocomplete {
  background: #252526 !important;
  border-color: #454545 !important;
  color: #d4d4d4 !important;
}
/* Overlay / dialogs */
.overlay {
  background: rgba(0,0,0,0.5) !important;
}
.info-panel {
  background: #252526 !important;
  border-color: #454545 !important;
  color: #d4d4d4 !important;
}
/* Permission select */
.permission-select {
  color: #d4d4d4 !important;
}
/* Thinking select */
.thinking-select {
  color: #d4d4d4 !important;
}
</style>
`;
