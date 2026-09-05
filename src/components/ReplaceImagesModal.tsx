import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore, type ReplaceJobRecord } from '../store/appStore';
import { getFile } from '../lib/pdf/fileCache';
import { MAX_REPLACEMENT_IMAGE_BYTES } from '../lib/files/limits';
import { scanImageOccurrences, mimeTypeForMediaPart, type ImageOccurrence } from '../lib/docx/edit/imageScan';
import { resolveReplacementImageType, type FitMode, type ImageReplaceSelection } from '../lib/docx/edit/imageReplace';
import { startImageReplaceBatch, cancelReplaceBatch } from '../lib/docx/edit/runBatchEdit';
import { writeOutputFile } from '../lib/files/outputWriter';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import OutputLocationPicker from './OutputLocationPicker';

type Step = 'setup' | 'running' | 'results';

interface WriteOutcome {
  writtenName?: string;
  error?: string;
}

function occurrenceKey(occurrence: ImageOccurrence): string {
  return `${occurrence.fileId}::${occurrence.id}`;
}

export default function ReplaceImagesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dialogRef, closeButtonRef } = useModalFocusTrap(open, onClose);
  const fileOrder = useAppStore((s) => s.fileOrder);
  const files = useAppStore((s) => s.files);
  const docxFiles = fileOrder.map((id) => files[id]).filter((f) => f && f.fileType === 'docx');

  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [occurrences, setOccurrences] = useState<ImageOccurrence[]>([]);
  const [selectedOccurrences, setSelectedOccurrences] = useState<Set<string>>(new Set());
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});

  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementDims, setReplacementDims] = useState<{ width: number; height: number } | null>(null);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>('fit');

  const [outputDir, setOutputDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('setup');
  const [writeOutcomes, setWriteOutcomes] = useState<Record<string, WriteOutcome>>({});

  const jobs = useAppStore((s) =>
    batchId ? Object.values(s.replaceJobs).filter((j) => j.batchId === batchId) : [],
  );

  // Object URLs are per-viewer thumbnails only — revoke whenever the occurrence set they were
  // built from is replaced (a new scan) or the modal closes, so they don't leak across runs.
  useEffect(() => {
    return () => {
      Object.values(thumbnailUrls).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbnailUrls]);

  const reset = () => {
    setSelectedFileIds(new Set());
    setOccurrences([]);
    setSelectedOccurrences(new Set());
    setThumbnailUrls((prev) => {
      Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    setReplacementFile(null);
    setReplacementDims(null);
    setReplacementError(null);
    setFitMode('fit');
    setOutputDir(null);
    setWriteOutcomes({});
    setStep('setup');
    if (batchId) {
      cancelReplaceBatch(batchId);
      useAppStore.getState().clearReplaceBatch(batchId);
    }
    setBatchId(null);
  };

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

  const occurrencesByFile = useMemo(() => {
    const map = new Map<string, ImageOccurrence[]>();
    for (const occurrence of occurrences) {
      const list = map.get(occurrence.fileId) ?? [];
      list.push(occurrence);
      map.set(occurrence.fileId, list);
    }
    return map;
  }, [occurrences]);

  if (!open) return null;

  const toggleFile = (id: string) => {
    setSelectedFileIds((prev) => {
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

  const runScan = async () => {
    setScanning(true);
    setOccurrences([]);
    setSelectedOccurrences(new Set());
    try {
      const results: ImageOccurrence[] = [];
      for (const fileRecord of docxFiles.filter((f) => selectedFileIds.has(f.id))) {
        const raw = getFile(fileRecord.id);
        if (!raw) continue;
        try {
          results.push(...(await scanImageOccurrences(fileRecord.id, raw)));
        } catch {
          // Skip files that fail to scan (corrupt/oversized) — the others still get scanned.
        }
      }
      setOccurrences(results);
      const urls: Record<string, string> = {};
      for (const occurrence of results) {
        urls[occurrenceKey(occurrence)] = URL.createObjectURL(
          new Blob([new Uint8Array(occurrence.mediaBytes)], { type: mimeTypeForMediaPart(occurrence.mediaPartPath) }),
        );
      }
      setThumbnailUrls(urls);
    } finally {
      setScanning(false);
    }
  };

  const toggleOccurrence = (key: string) => {
    setSelectedOccurrences((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pickReplacementFile = async (file: File | null) => {
    setReplacementError(null);
    setReplacementFile(null);
    setReplacementDims(null);
    if (!file) return;
    try {
      resolveReplacementImageType(file.name);
    } catch (error) {
      setReplacementError(error instanceof Error ? error.message : 'Unsupported image.');
      return;
    }
    if (file.size > MAX_REPLACEMENT_IMAGE_BYTES) {
      setReplacementError('That image is too large to use as a replacement.');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      setReplacementDims({ width: bitmap.width, height: bitmap.height });
      bitmap.close();
      setReplacementFile(file);
    } catch {
      setReplacementError('Fynder could not read that image file.');
    }
  };

  const selectedCount = selectedOccurrences.size;
  const canStart = selectedCount > 0 && replacementFile != null && replacementDims != null && outputDir != null;

  const startRun = async () => {
    if (!replacementFile || !replacementDims) return;
    const { extension, contentType } = resolveReplacementImageType(replacementFile.name);
    const replacementBytes = new Uint8Array(await replacementFile.arrayBuffer());

    const byFile = new Map<string, ImageReplaceSelection[]>();
    for (const occurrence of occurrences) {
      if (!selectedOccurrences.has(occurrenceKey(occurrence))) continue;
      const list = byFile.get(occurrence.fileId) ?? [];
      list.push({
        partPath: occurrence.partPath,
        blipIndex: occurrence.blipIndex,
        expectedRelationshipId: occurrence.relationshipId,
      });
      byFile.set(occurrence.fileId, list);
    }

    const inputs = Array.from(byFile.entries())
      .map(([fileId, selections]) => {
        const raw = getFile(fileId);
        const record = files[fileId];
        if (!raw || !record) return null;
        return { fileId, fileName: record.name, file: raw, selections };
      })
      .filter((x): x is { fileId: string; fileName: string; file: File; selections: ImageReplaceSelection[] } => x != null);

    if (inputs.length === 0) return;
    const newBatchId = crypto.randomUUID();
    setBatchId(newBatchId);
    setStep('running');
    startImageReplaceBatch(newBatchId, inputs, {
      replacementBytes,
      extension,
      contentType,
      imageWidth: replacementDims.width,
      imageHeight: replacementDims.height,
      fitMode,
    });
  };

  return createPortal(
    <div
      className="file-discovery"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section ref={dialogRef} className="file-discovery__dialog" role="dialog" aria-modal="true" aria-labelledby="replace-images-title">
        <header className="file-discovery__header">
          <div>
            <h2 id="replace-images-title">Replace Images</h2>
            <p>
              Replaces selected occurrences of embedded pictures. Replacing one occurrence never affects other
              occurrences that happen to share the same original image. Only standard embedded pictures are
              found — not VML fallback drawings or externally linked images. Originals are never changed.
            </p>
          </div>
          <button ref={closeButtonRef} type="button" className="file-discovery__close" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </header>

        {step === 'setup' && (
          <div className="file-discovery__body">
            <section className="file-discovery__section">
              <h3><span>1</span> Choose files and scan</h3>
              {docxFiles.length === 0 && <p className="file-discovery__empty">No Word documents are loaded.</p>}
              <div className="file-discovery__table-wrap">
                {docxFiles.map((file) => (
                  <label key={file.id} className="file-discovery__check">
                    <input type="checkbox" checked={selectedFileIds.has(file.id)} onChange={() => toggleFile(file.id)} />
                    {file.name}
                  </label>
                ))}
              </div>
              <button type="button" disabled={selectedFileIds.size === 0 || scanning} onClick={() => void runScan()}>
                {scanning ? 'Scanning…' : 'Scan for images'}
              </button>
            </section>

            {occurrences.length > 0 && (
              <section className="file-discovery__section file-discovery__results">
                <h3><span>2</span> Select occurrences ({selectedCount} selected)</h3>
                <div className="image-occurrence-grid">
                  {Array.from(occurrencesByFile.entries()).map(([fileId, fileOccurrences]) => (
                    <div key={fileId} className="image-occurrence-grid__file">
                      <h4>{files[fileId]?.name ?? fileId}</h4>
                      <div className="image-occurrence-grid__items">
                        {fileOccurrences.map((occurrence) => {
                          const key = occurrenceKey(occurrence);
                          return (
                            <label key={key} className="image-occurrence-card">
                              <input
                                type="checkbox"
                                checked={selectedOccurrences.has(key)}
                                onChange={() => toggleOccurrence(key)}
                              />
                              {thumbnailUrls[key] && (
                                <img src={thumbnailUrls[key]} alt="" className="image-occurrence-card__thumb" />
                              )}
                              <span className="image-occurrence-card__location">{occurrence.location}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {occurrences.length === 0 && !scanning && selectedFileIds.size > 0 && (
              <p className="file-discovery__hint">Scan the selected files to find image occurrences.</p>
            )}

            <section className="file-discovery__section">
              <h3><span>3</span> Replacement image</h3>
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/bmp"
                onChange={(event) => void pickReplacementFile(event.target.files?.[0] ?? null)}
              />
              {replacementFile && replacementDims && (
                <p className="file-discovery__hint">
                  {replacementFile.name} ({replacementDims.width}×{replacementDims.height})
                </p>
              )}
              {replacementError && <p className="file-discovery__warning">{replacementError}</p>}
              <div className="file-discovery__filter-options">
                <label className="file-discovery__check">
                  <input type="radio" name="fit-mode" checked={fitMode === 'fit'} onChange={() => setFitMode('fit')} />
                  Fit, no distortion
                </label>
                <label className="file-discovery__check">
                  <input type="radio" name="fit-mode" checked={fitMode === 'crop'} onChange={() => setFitMode('crop')} />
                  Fill and crop
                </label>
                <label className="file-discovery__check">
                  <input type="radio" name="fit-mode" checked={fitMode === 'stretch'} onChange={() => setFitMode('stretch')} />
                  Stretch to fit
                </label>
              </div>
            </section>

            <section className="file-discovery__section">
              <h3><span>4</span> Output location</h3>
              <OutputLocationPicker directoryHandle={outputDir} onChange={setOutputDir} />
            </section>
          </div>
        )}

        {step !== 'setup' && <ImageReplaceJobList jobs={jobs} writeOutcomes={writeOutcomes} />}

        <footer className="file-discovery__footer">
          <div />
          <div>
            <button type="button" onClick={handleClose}>{step === 'results' ? 'Close' : 'Cancel'}</button>
            {step === 'setup' && (
              <button type="button" className="file-discovery__primary" disabled={!canStart} onClick={() => void startRun()}>
                Replace {selectedCount} occurrence{selectedCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ImageReplaceJobList({
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
  if (job.status === 'skipped') return 'No occurrences replaced — skipped.';
  if (job.status === 'cancelled') return 'Cancelled.';
  if (!writeOutcome) return 'Writing output…';
  if (writeOutcome.error) return writeOutcome.error;
  return `Saved as ${writeOutcome.writtenName} (${job.matchCount} replaced).`;
}
