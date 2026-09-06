import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Info, Trash2, Upload } from 'lucide-react';
import { parseEmailCsv, MAX_RECIPIENTS } from '../utils/emailList';

// Comfortably above a 5,000-row address list (~200 KB) and low enough that a
// mis-picked video or database dump is refused instantly instead of being read
// into memory by the browser.
const MAX_CSV_BYTES = 2 * 1024 * 1024;

const SAMPLE_CSV = ['email', 'ada@example.com', 'grace@example.com', 'alan@example.com', ''].join('\n');

const formatBytes = (bytes) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);

/**
 * The CSV format help. Written out rather than left to guesswork because the
 * whole point of auto-detection is that an admin should not have to think about
 * it — but they do need to know it will not silently mail the wrong column.
 */
const CsvFormatTooltip = ({ id }) => (
  <div
    id={id}
    role="tooltip"
    className="absolute left-0 top-full z-30 mt-2 w-[min(28rem,calc(100vw-3rem))] space-y-3 rounded-xl border border-line bg-night-raised p-4 text-xs leading-relaxed text-silver-muted shadow-2xl"
  >
    <p className="text-sm font-semibold text-silver">Accepted CSV shapes</p>

    <div>
      <p className="mb-1.5">One address per row. A header row is optional:</p>
      <pre className="overflow-x-auto rounded-lg border border-line/60 bg-night p-2.5 font-mono text-[11px] text-silver">
{`email
ada@example.com
grace@example.com`}
      </pre>
    </div>

    <div>
      <p className="mb-1.5">
        With several columns, name the address column <code className="text-silver">email</code> — every other
        column is ignored, so a second address column is never mailed by mistake:
      </p>
      <pre className="overflow-x-auto rounded-lg border border-line/60 bg-night p-2.5 font-mono text-[11px] text-silver">
{`name,email,joined
"Lovelace, Ada",ada@example.com,2026-01-04`}
      </pre>
    </div>

    <ul className="list-disc space-y-1 pl-4">
      <li>No header at all works too — a bare list of addresses is read as-is.</li>
      <li>Commas, semicolons or tabs as the separator; quoted fields are handled.</li>
      <li>Saved from Excel as &quot;CSV UTF-8&quot; is fine.</li>
      <li>Duplicates and malformed rows are removed and reported before you send.</li>
      <li>
        Up to {MAX_CSV_BYTES / (1024 * 1024)} MB per file and{' '}
        {MAX_RECIPIENTS.toLocaleString('en-US')} addresses per campaign.
      </li>
    </ul>
  </div>
);

/**
 * Paste-a-list plus CSV-upload recipient picker for the marketing audience.
 *
 * Parsing happens here as the admin types so the counts are immediate; the
 * server parses the same input again on dispatch and its numbers are the ones
 * that decide what is sent.
 */
const EmailListRecipients = ({ rawEmails, onRawEmailsChange, csvFiles, onCsvFilesChange, parsed, inputClass }) => {
  const [showHelp, setShowHelp] = useState(false);
  const [fileError, setFileError] = useState(null);
  const [showInvalid, setShowInvalid] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const helpWrapRef = useRef(null);

  // Click-outside and Escape close the popover. Without this it stays open over
  // the form once opened by click rather than hover.
  useEffect(() => {
    if (!showHelp) return undefined;
    const onDocClick = (e) => {
      if (helpWrapRef.current && !helpWrapRef.current.contains(e.target)) setShowHelp(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowHelp(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showHelp]);

  const readFiles = useCallback(
    async (fileList) => {
      const incoming = Array.from(fileList || []);
      if (!incoming.length) return;

      setFileError(null);
      const accepted = [];
      const rejected = [];

      for (const file of incoming) {
        // Checked by extension, not MIME type: browsers report a .csv as
        // text/csv, application/vnd.ms-excel or text/plain depending on the OS
        // and whether Excel is installed, so the type is not dependable.
        if (!/\.(csv|txt)$/i.test(file.name)) {
          rejected.push(`${file.name} — not a .csv file`);
          continue;
        }
        if (file.size > MAX_CSV_BYTES) {
          rejected.push(`${file.name} — ${formatBytes(file.size)}, over the ${MAX_CSV_BYTES / (1024 * 1024)} MB limit`);
          continue;
        }
        if (file.size === 0) {
          rejected.push(`${file.name} — the file is empty`);
          continue;
        }
        if (csvFiles.some((existing) => existing.name === file.name && existing.size === file.size)) {
          rejected.push(`${file.name} — already added`);
          continue;
        }

        try {
          const text = await file.text();
          const result = parseEmailCsv(text);
          if (!result.emails.length && !result.invalidCount) {
            rejected.push(`${file.name} — no rows found`);
            continue;
          }
          accepted.push({ name: file.name, size: file.size, result });
        } catch {
          rejected.push(`${file.name} — could not be read`);
        }
      }

      if (accepted.length) onCsvFilesChange([...csvFiles, ...accepted]);
      if (rejected.length) setFileError(rejected.join(' · '));
    },
    [csvFiles, onCsvFilesChange]
  );

  const handleInputChange = (e) => {
    readFiles(e.target.files);
    // Cleared so picking the same file again after removing it still fires.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index) => {
    onCsvFilesChange(csvFiles.filter((_, i) => i !== index));
    setFileError(null);
  };

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'recipients-sample.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const total = parsed.emails.length;
  const overCap = total > MAX_RECIPIENTS;

  return (
    <div className="space-y-4 rounded-lg border border-line bg-night/50 p-4">
      <div>
        <label htmlFor="camp-emails" className="mb-1.5 block text-sm font-medium text-silver">
          Email addresses
        </label>
        <textarea
          id="camp-emails"
          rows={4}
          value={rawEmails}
          onChange={(e) => onRawEmailsChange(e.target.value)}
          placeholder={'a@abc.com, b@abc.com\nc@abc.com'}
          className={`${inputClass} font-mono text-[13px]`}
          aria-describedby="camp-emails-help"
        />
        <p id="camp-emails-help" className="mt-1.5 text-xs text-silver-muted">
          Separate with commas, semicolons, spaces or new lines — extra spacing and line breaks are fine.
          Recipients do not need an account.
        </p>
      </div>

      {/* CSV upload */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          readFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border border-dashed p-3 transition-colors ${
          dragging ? 'border-crimson bg-crimson/5' : 'border-line'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-silver transition-colors hover:border-crimson/60">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Upload CSV
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              onChange={handleInputChange}
            />
          </label>

          <span className="text-xs text-silver-muted">or drop a file here</span>

          <div className="relative ml-auto" ref={helpWrapRef}>
            <button
              type="button"
              onClick={() => setShowHelp((open) => !open)}
              onMouseEnter={() => setShowHelp(true)}
              onFocus={() => setShowHelp(true)}
              aria-expanded={showHelp}
              aria-describedby={showHelp ? 'csv-format-help' : undefined}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-silver-muted transition-colors hover:text-silver"
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              CSV format
            </button>
            {showHelp && <CsvFormatTooltip id="csv-format-help" />}
          </div>

          <button
            type="button"
            onClick={downloadSample}
            className="flex cursor-pointer items-center gap-1.5 text-xs text-silver-muted transition-colors hover:text-silver"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Sample
          </button>
        </div>

        {csvFiles.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {csvFiles.map((file, index) => (
              <li
                key={`${file.name}-${file.size}`}
                className="flex items-center gap-2 rounded-md border border-line bg-night-surface px-2.5 py-1.5 text-xs"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-silver-muted" aria-hidden="true" />
                <span className="truncate font-medium text-silver">{file.name}</span>
                <span className="ml-auto shrink-0 text-silver-muted">
                  {file.result.emails.length} address{file.result.emails.length === 1 ? '' : 'es'}
                  {file.result.invalidCount ? ` · ${file.result.invalidCount} skipped` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  aria-label={`Remove ${file.name}`}
                  className="shrink-0 cursor-pointer text-silver-muted transition-colors hover:text-crimson-soft"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {fileError && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-crimson-soft">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{fileError}</span>
          </p>
        )}
      </div>

      {/* Parse summary — the same numbers the server will report back. */}
      {(parsed.totalFound > 0 || csvFiles.length > 0) && (
        <div
          className={`rounded-lg border p-3 text-xs ${
            overCap ? 'border-crimson/40 bg-crimson/10' : 'border-line/60 bg-night-surface'
          }`}
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-silver">
              {total.toLocaleString('en-US')} address{total === 1 ? '' : 'es'} ready
            </span>
            {parsed.duplicateCount > 0 && (
              <span className="text-silver-muted">{parsed.duplicateCount} duplicate{parsed.duplicateCount === 1 ? '' : 's'} removed</span>
            )}
            {parsed.invalidCount > 0 && (
              <button
                type="button"
                onClick={() => setShowInvalid((open) => !open)}
                className="cursor-pointer text-amber-400 underline-offset-2 hover:underline"
              >
                {parsed.invalidCount} invalid — {showInvalid ? 'hide' : 'show'}
              </button>
            )}
          </div>

          {overCap && (
            <p className="mt-2 flex items-start gap-1.5 text-crimson-soft">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Over the {MAX_RECIPIENTS.toLocaleString('en-US')}-address limit for one campaign. Remove{' '}
                {(total - MAX_RECIPIENTS).toLocaleString('en-US')} or split this into several sends.
              </span>
            </p>
          )}

          {showInvalid && parsed.invalid.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-line/60 bg-night p-2 font-mono text-[11px] text-silver-muted">
              {parsed.invalid.map((entry, index) => (
                <li key={`${entry.value}-${index}`} className="truncate">
                  {entry.line ? <span className="text-silver-muted/60">line {entry.line}: </span> : null}
                  {entry.value}
                </li>
              ))}
              {parsed.invalidCount > parsed.invalid.length && (
                <li className="text-silver-muted/60">
                  …and {parsed.invalidCount - parsed.invalid.length} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default EmailListRecipients;
