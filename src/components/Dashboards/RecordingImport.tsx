import React, { useRef, useState } from 'react';
import { IconButton, useMutation } from '../../lib/denim/lib';
import { GET_RECORDINGS, IMPORT_RECORDING } from '../Telemetry/Recordings/queries';
import { parseImportedCsv } from '../Telemetry/Recordings/chartUtils';

// Accepts a CSV previously produced by RecordingChart's own "Export CSV"
// (see chartUtils.ts's toCsv/parseImportedCsv for the `# key=value`
// metadata-line encoding) and creates a new Recording + its RecordingFrame
// rows from it via the importRecording mutation. Best-effort, not a
// lossless round-trip — only whatever fields were checked in the legend at
// export time survive (see importRecording's own doc comment in
// graphql/recording.rs for exactly what's dropped and why).
const RecordingImport: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importRecording] = useMutation(IMPORT_RECORDING, { refetchQueries: [{ query: GET_RECORDINGS }] });

  const handleFile = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseImportedCsv(text);
      if (parsed.frames.length === 0) throw new Error('No data rows found in this file.');
      await importRecording({
        variables: {
          name: file.name.replace(/\.csv$/i, ''),
          sampleRateHz: parsed.sampleRateHz,
          car: parsed.car,
          framesJson: JSON.stringify(parsed.frames),
        },
      });
    } catch (e: any) {
      setError(e?.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {/* Plain IconButton, no custom padding/border — matches the other
          controls in this row (SwitchableList's view toggle, Links' back/
          new icons), unlike a labeled DefaultButton which looked out of
          place among them. Errors surface via the tooltip/title rather than
          adjacent text, so a rare failure doesn't widen this icon strip. */}
      <IconButton
        iconProps={{ iconName: importing ? 'HourGlass' : 'Upload' }}
        title={error ? `Import CSV — last attempt failed: ${error}` : 'Import CSV'}
        disabled={importing}
        onClick={() => inputRef.current?.click()}
        style={error ? { color: '#d13438' } : undefined}
      />
    </>
  );
};

export default RecordingImport;
