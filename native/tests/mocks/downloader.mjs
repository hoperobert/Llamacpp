// The download library's interface, with tasks a test drives by hand.
import { disk, writeWhole } from './files.mjs';

export const created = [];           // every task ever created, in order
let existing = [];                   // what the library reports when the app starts
export const setExisting = (tasks) => { existing = tasks; };
export const directories = { documents: 'doc' };
export const completeHandler = () => {};
export const setConfig = () => {};
export const getExistingDownloadTasks = async () => existing;

export function createDownloadTask({ id, destination, headers }) {
  const range = headers?.Range?.match(/bytes=(\d+)-(\d+)/);
  const task = {
    id, headers, state: 'PENDING', bytesDownloaded: 0,
    file: destination.split('/').pop(),
    /** How many bytes this task was asked for. Null means the whole file. */
    wanted: range ? Number(range[2]) - Number(range[1]) + 1 : null,
    log: [],
    progress(handler) { task.onProgress = handler; return task; },
    done(handler) { task.onDone = handler; return task; },
    error(handler) { task.onError = handler; return task; },
    begin() { return task; },
    start() { task.log.push('start'); task.state = 'DOWNLOADING'; },
    async pause() { task.log.push('pause'); task.state = 'PAUSED'; },
    async resume() { task.log.push('resume'); task.state = 'DOWNLOADING'; },
    async stop() { task.log.push('stop'); task.state = 'STOPPED'; },

    // What a test makes happen.
    arrive(bytes) { task.bytesDownloaded = bytes; task.onProgress?.({ bytesDownloaded: bytes, bytesTotal: task.wanted ?? 0 }); },
    /** Completes the task. The file holds the piece number in every byte. */
    finish(size = task.wanted) {
      const piece = Number(id.split('#')[1]);
      writeWhole(task.file, size, piece);
      task.bytesDownloaded = size;
      task.state = 'DONE';
      task.onDone?.({});
    },
    fail(error) { disk.delete(task.file); task.state = 'FAILED'; task.onError?.({ error }); },
  };
  created.push(task);
  return task;
}
