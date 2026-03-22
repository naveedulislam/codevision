/**
 * Comprehensive mock of the `vscode` module for Jest tests.
 *
 * Only the APIs actually used by the CodePlanner extension are stubbed.
 */

// ---------------------------------------------------------------------------
// Event / Disposable helpers
// ---------------------------------------------------------------------------

export class Disposable {
  constructor(private _dispose: () => void) {}
  dispose() { this._dispose(); }
}

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this._listeners.push(listener);
    return new Disposable(() => {
      this._listeners = this._listeners.filter(l => l !== listener);
    });
  };
  fire(data: T) {
    for (const l of this._listeners) { l(data); }
  }
  dispose() { this._listeners = []; }
}

// ---------------------------------------------------------------------------
// URI
// ---------------------------------------------------------------------------

export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly fsPath: string;

  private constructor(scheme: string, authority: string, fsPath: string, query = '', fragment = '') {
    this.scheme = scheme;
    this.authority = authority;
    this.path = fsPath;
    this.fsPath = fsPath;
    this.query = query;
    this.fragment = fragment;
  }

  static file(p: string): Uri {
    return new Uri('file', '', p);
  }

  static parse(value: string): Uri {
    if (value.startsWith('file://')) {
      return new Uri('file', '', value.slice(7));
    }
    return new Uri('unknown', '', value);
  }

  toString() {
    return `${this.scheme}://${this.fsPath}`;
  }
}

// ---------------------------------------------------------------------------
// Position / Range / Selection
// ---------------------------------------------------------------------------

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  constructor(public readonly start: Position, public readonly end: Position) {}
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;
  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
}

// ---------------------------------------------------------------------------
// DocumentDropEdit
// ---------------------------------------------------------------------------

export class DocumentDropEdit {
  constructor(public readonly insertText: string | { value: string }) {}
}

// ---------------------------------------------------------------------------
// TreeItem
// ---------------------------------------------------------------------------

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  collapsibleState?: TreeItemCollapsibleState;

  constructor(label: string, collapsible?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsible ?? TreeItemCollapsibleState.None;
  }
}

// ---------------------------------------------------------------------------
// ThemeIcon
// ---------------------------------------------------------------------------

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

// ---------------------------------------------------------------------------
// DiagnosticSeverity
// ---------------------------------------------------------------------------

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

// ---------------------------------------------------------------------------
// ProgressLocation
// ---------------------------------------------------------------------------

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

// ---------------------------------------------------------------------------
// ViewColumn
// ---------------------------------------------------------------------------

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

// ---------------------------------------------------------------------------
// CancellationToken
// ---------------------------------------------------------------------------

export const CancellationTokenSource = class {
  token = { isCancellationRequested: false, onCancellationRequested: jest.fn() };
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
};

// ---------------------------------------------------------------------------
// DataTransfer / DataTransferItem
// ---------------------------------------------------------------------------

export class DataTransferItem {
  constructor(private _value: unknown) {}
  asString(): Promise<string> { return Promise.resolve(String(this._value)); }
  asFile() { return undefined; }
  get value() { return this._value; }
}

export class DataTransfer {
  private _map = new Map<string, DataTransferItem>();

  set(mimeType: string, item: DataTransferItem) {
    this._map.set(mimeType, item);
  }

  get(mimeType: string): DataTransferItem | undefined {
    return this._map.get(mimeType);
  }

  forEach(cb: (item: DataTransferItem, mimeType: string) => void) {
    this._map.forEach((item, mime) => cb(item, mime));
  }
}

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------

export const workspace = {
  workspaceFolders: [
    {
      uri: Uri.file('/test-workspace'),
      name: 'test-workspace',
      index: 0,
    },
  ],
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn((key: string, defaultVal?: unknown) => defaultVal),
  }),
  openTextDocument: jest.fn().mockResolvedValue({
    uri: Uri.file('/test.md'),
    getText: jest.fn().mockReturnValue(''),
    lineCount: 1,
  }),
  asRelativePath: jest.fn((p: string) => {
    const root = '/test-workspace/';
    if (typeof p === 'string' && p.startsWith(root)) {
      return p.slice(root.length);
    }
    return p;
  }),
  getWorkspaceFolder: jest.fn().mockReturnValue({
    uri: Uri.file('/test-workspace'),
    name: 'test-workspace',
    index: 0,
  }),
  fs: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(new Uint8Array()),
  },
};

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

const _mockEditor = {
  document: { uri: Uri.file('/test.md') },
  selection: new Selection(new Position(0, 0), new Position(0, 0)),
  edit: jest.fn().mockImplementation((cb: (eb: { insert: jest.Mock }) => void) => {
    const eb = { insert: jest.fn() };
    cb(eb);
    return Promise.resolve(true);
  }),
  revealRange: jest.fn(),
};

export const window = {
  activeTextEditor: _mockEditor,
  showTextDocument: jest.fn().mockResolvedValue(_mockEditor),
  showInformationMessage: jest.fn().mockResolvedValue(undefined),
  showWarningMessage: jest.fn().mockResolvedValue(undefined),
  showErrorMessage: jest.fn().mockResolvedValue(undefined),
  showOpenDialog: jest.fn().mockResolvedValue(undefined),
  createTreeView: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  createWebviewPanel: jest.fn().mockReturnValue({
    webview: { html: '' },
    reveal: jest.fn(),
    onDidDispose: jest.fn(),
    dispose: jest.fn(),
    title: '',
  }),
  withProgress: jest.fn().mockImplementation((_opts: unknown, task: (progress: unknown) => Promise<unknown>) => {
    const progress = { report: jest.fn() };
    return task(progress);
  }),
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

export const commands = {
  registerCommand: jest.fn().mockReturnValue(new Disposable(() => {})),
  executeCommand: jest.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// languages
// ---------------------------------------------------------------------------

export const languages = {
  getDiagnostics: jest.fn().mockReturnValue([]),
  registerDocumentDropEditProvider: jest.fn().mockReturnValue(new Disposable(() => {})),
};

// ---------------------------------------------------------------------------
// lm (Language Model)
// ---------------------------------------------------------------------------

export const lm = {
  registerTool: jest.fn().mockReturnValue(new Disposable(() => {})),
};
