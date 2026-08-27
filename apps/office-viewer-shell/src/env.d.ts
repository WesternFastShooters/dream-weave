interface Window {
  DocsAPI?: { DocEditor: new (elementId: string, config: OnlyOfficeConfig) => OnlyOfficeEditor };
}

interface OnlyOfficeEditor {
  destroyEditor?: () => void;
}

interface OnlyOfficeConfig {
  type: 'embedded';
  document: { fileType: OfficeSessionConfig['fileType']; key: string; title: string; url: string; permissions: { edit: false; download: false; print: false; comment: false; copy: false } };
  documentType: OfficeSessionConfig['documentType'];
  editorConfig: {
    mode: 'view';
    coEditing: { mode: 'strict'; change: false };
    embedded: { autostart: 'document'; toolbarDocked: 'bottom' };
    customization: { compactHeader: true; compactToolbar: true; hideRulers: true; hideRightMenu: true; showHorizontalScroll: false; showVerticalScroll: false; toolbarNoTabs: true };
  };
  events: { onDocumentReady: () => void; onError: (event: { data?: { errorCode?: unknown } }) => void };
  token: string;
}
