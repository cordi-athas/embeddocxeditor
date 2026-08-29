import { useRef, useState } from 'react';
import { DocxEditor, type DocxEditorHandle } from 'embeddocx-react';

// The hosted editor app (running separately). Cross-origin from this host (5174).
const EDITOR_URL = 'http://localhost:5173/';

const docxBlob = (bytes: Uint8Array) =>
  new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

function download(bytes: Uint8Array, name = 'document.docx') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(docxBlob(bytes));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const btnStyle = {
  padding: '7px 12px',
  background: '#1e293b',
  color: '#e2e8f0',
  border: 0,
  borderRadius: 7,
  cursor: 'pointer',
} as const;

export default function App() {
  const ref = useRef<DocxEditorHandle>(null);
  const [doc, setDoc] = useState<ArrayBuffer | undefined>();
  const [docName, setDocName] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [printed, setPrinted] = useState<string | undefined>();

  const save = async () => {
    const bytes = await ref.current!.getDocx();
    download(bytes);
  };

  // The editor renders the document to PDF and hands it to the browser's print
  // dialog. The resolved value says how it was served ('dialog' | 'tab' |
  // 'download') — a host command carries no click gesture into the editor
  // frame, so Safari falls back to downloading the PDF.
  const printDoc = async () => {
    try {
      setPrinted(await ref.current!.print());
    } catch (e) {
      setPrinted(`failed: ${(e as Error).message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui' }}>
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '10px 14px',
          background: '#0f172a',
          color: '#e2e8f0',
        }}
      >
        <strong style={{ color: '#38bdf8' }}>React Host · embeddocx-react</strong>
        <span style={{ flex: 1 }} />
        <label
          style={{ cursor: 'pointer', padding: '7px 12px', background: '#1e293b', borderRadius: 7 }}
        >
          Load document
          <input
            id="file"
            type="file"
            accept=".docx,.odt,.rtf"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setDocName(f.name);
              setDoc(await f.arrayBuffer());
            }}
          />
        </label>
        <button id="save" onClick={save} style={btnStyle}>
          Download DOCX
        </button>
        <button id="print" onClick={printDoc} style={btnStyle}>
          Print
        </button>
        {printed && (
          <span id="printed" style={{ fontSize: 12, color: '#94a3b8' }}>
            print → {printed}
          </span>
        )}
        <span id="status" style={{ fontSize: 12, color: dirty ? '#fbbf24' : '#34d399' }}>
          {dirty ? '● unsaved' : ready ? '● ready' : 'loading…'}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: 16, background: '#1e293b' }}>
        <DocxEditor
          ref={ref}
          src={EDITOR_URL}
          document={doc}
          documentName={docName}
          onReady={() => setReady(true)}
          onChange={() => setDirty(true)}
          onClean={() => setDirty(false)}
          onSave={save}
          style={{ height: '100%', borderRadius: 12, background: '#fff' }}
        />
      </div>
    </div>
  );
}
