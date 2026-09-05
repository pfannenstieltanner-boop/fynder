import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore, type ReplaceJobRecord } from '../store/appStore';
import { getFile } from '../lib/pdf/fileCache';
import { startTextReplaceBatch, cancelReplaceBatch } from '../lib/docx/edit/runBatchEdit';
import { writeOutputFile } from '../lib/files/outputWriter';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import OutputLocationPicker from './OutputLocationPicker';

type Step = 'setup' | 'running' | 'results';

interface WriteOutcome {
  writtenName?: string;
  error?: string;
}

export default function ReplaceTextModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dialogRef, closeButtonRef } = useModalFocusTrap(open, onClose);
  const fileOrder = useAppStore((s) => s.fileOrder);
  const files = useAppStore((s) => s.files);
  const docxFiles = fileOrder.map((id) => files[id]).filter((f) => f && f.fileType === 'docx');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [find, setFind] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [outputDir, setOutputDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('setup');
  const [writeOutcomes, setWriteOutcomes] = useState<Record<string, WriteOutcome>>({});

  const jobs = useAppStore((s) =>
    batchId ? Object.values(s.replaceJobs).filter((j) => j.batchId === batchId) : [],
  );

  const reset = () => {
    setSelectedIds(new Set());
    setFind('');
    setReplaceWith('');
    setMatchCase(false);
    setWholeWord(false);
    setOutputDir(null);
    setWriteOutcomes({});
    setStep('setup');
    if (batchId) {
      cancelReplaceBatch(batchId);
      useAppStore.getState().clearReplaceBatch(batchId);
    }
    setBatchId(null);
  };

  // Writes each job's output file to disk as soon as its compute finishes, rather than waiting
  // for the whole batch — large batches then show progress incrementally instead of all at once
  // at the very end.
  useEffect(() => {
    if (!outputDir) return;
    for (const job of jobs) {
      if (job.status !== 'done' || !job.resultBlob || job.id in writeOutcomes) continue;
      const blob = job.resultBlob;
      const jobId = job.id;
      void writeOutputFile(outputDir, job.outputFileName, blob)
        .then((writtenName) => setWriteOutcomes((prev) => ({ ...prev, [jobId]: { writtenName } })))
        .catch((error: unknown) =>
          setWriteOutcomes((prev) => ({
            ...prev,
            [jobId]: { error: error instanceof Error ? error.message : 'Failed to write output file.' },
          })),
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, outputDir]);

  useEffect(() => {
    if (step !== 'running' || jobs.length === 0) return;
    const allSettled = jobs.every((job) => {
      if (job.status === 'failed' || job.status === 'skipped' || job.status === 'cancelled') return true;
      if (job.status !== 'done') return false;
      return job.id in writeOutcomes;
    });
    if (allSettled) setStep('results');
  }, [jobs, step, writeOutcomes]);

  if (!open) return null;

  const toggleFile = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const startRun = () => {
    const selected = docxFiles.filter((f) => selectedIds.has(f.id));
    const inputs = selected
      .map((f) => ({ fileId: f.id, fileName: f.name, file: getFile(f.id) }))
      .filter((f): f is { fileId: string; fileName: string; file: File } => f.file != null);
    if (inputs.length === 0) return;
    const newBatchId = crypto.randomUUID();
    setBatchId(newBatchId);
    setStep('running');
    startTextReplaceBatch(newBatchId, inputs, { find, replaceWith, matchCase, wholeWord });
  };

  const canStart = selectedIds.size > 0 && find.length > 0 && outputDir != null;

  return createPortal(
    <div
      className="file-discovery"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section ref={dialogRef} className="file-discovery__dialog" role="dialog" aria-modal="true" aria-labelledby="replace-text-title">
        <header className="file-discovery__header">
          <div>
            <h2 id="replace-text-title">Replace Text</h2>
            <p>Removes or replaces matching text in Word documents. Originals are never changed — output is written as new files.</p>
          </div>
          <button ref={closeButtonRef} type="button" className="file-discovery__close" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </header>

        {step === 'setup' && (
          <div className="file-discovery__body">
            <section className="file-discovery__section">
              <h3><span>1</span> Choose files</h3>
              {docxFiles.length === 0 && <p className="file-discovery__empty">No Word documents are loaded.</p>}
              <div className="file-discovery__table-wrap">
                {docxFiles.map((file) => (
                  <label key={file.id} className="file-discovery__check">
                    <input type="checkbox" checked={selectedIds.has(file.id)} onChange={() => toggleFile(file.id)} />
                    {file.name}
                  </label>
                ))}
              </div>
            </section>

            <section className="file-discovery__section">
              <h3><span>2</span> Find and replace</h3>
              <div className="file-discovery__field">
                <label className="file-discovery__label">Find</label>
                <input value={find} onChange={(event) => setFind(event.target.value)} placeholder="Text to find" />
              </div>
              <div className="file-discovery__field">
                <label className="file-discovery__label">
                  Replace with <span>(optional — leave blank to remove)</span>
                </label>
                <input value={replaceWith} onChange={(event) => setReplaceWith(event.target.value)} placeholder="Replacement text" />
              </div>
              <label className="file-discovery__check">
                <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
                Match case
              </label>
              <label className="file-discovery__check">
                <input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} />
                Whole word only
              </label>
            </section>

            <section className="file-discovery__section">
              <h3><span>3</span> Output location</h3>
              <OutputLocationPicker directoryHandle={outputDir} onChange={setOutputDir} />
            </section>
          </div>
        )}

        {step !== 'setup' && <ReplaceJobList jobs={jobs} writeOutcomes={writeOutcomes} />}

        <footer className="file-discovery__footer">
          <div />
          <div>
            <button type="button" onClick={handleClose}>{step === 'results' ? 'Close' : 'Cancel'}</button>
            {step === 'setup' && (
              <button type="button" className="file-discovery__primary" disabled={!canStart} onClick={startRun}>
                Start ({selectedIds.size} file{selectedIds.size === 1 ? '' : 's'})
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ReplaceJobList({
  jobs,
  writeOutcomes,
}: {
  jobs: ReplaceJobRecord[];
  writeOutcomes: Record<string, WriteOutcome>;
}) {
  return (
    <section className="file-discovery__section file-discovery__results">
      <h3>Progress</h3>
      <div className="file-discovery__table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.sourceFileName}</td>
                <td>{describeJobStatus(job, writeOutcomes[job.id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function describeJobStatus(job: ReplaceJobRecord, writeOutcome: WriteOutcome | undefined): string {
  if (job.status === 'queued' || job.status === 'running') return 'Processing…';
  if (job.status === 'failed') return job.error ?? 'Failed.';
  if (job.status === 'skipped') return 'No matches — skipped.';
  if (job.status === 'cancelled') return 'Cancelled.';
  if (!writeOutcome) return 'Writing output…';
  if (writeOutcome.error) return writeOutcome.error;
  return `Saved as ${writeOutcome.writtenName} (${job.matchCount} match${job.matchCount === 1 ? '' : 'es'}).`;
}
