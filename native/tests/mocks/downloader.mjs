// The download library's interface, with tasks the test drives by hand.
import { disk } from './files.mjs';
export const created = [];           // every task ever created, in order
export let existing = [];            // what the library reports at launch
export const setExisting = (tasks) => { existing = tasks; };
export const directories = { documents: 'doc' };
export const completeHandler = () => {};
export const setConfig = () => {};
export const getExistingDownloadTasks = async () => existing;
export function makeTask({ id, state = 'PENDING', bytesDownloaded = 0, bytesTotal = 0, file }) {
  const task = {
    id, state, bytesDownloaded, bytesTotal, file, log: [],
    progress(h) { task.onProgress = h; return task; },
    done(h) { task.onDone = h; return task; },
    error(h) { task.onError = h; return task; },
    begin() { return task; },
    start() { task.log.push('start'); task.state = 'DOWNLOADING'; },
    async pause() { task.log.push('pause'); task.state = 'PAUSED'; },
    async resume() { task.log.push('resume'); task.state = 'DOWNLOADING'; },
    async stop() { task.log.push('stop'); task.state = 'STOPPED'; },
    // helpers for the test
    finishWith(bytes) { disk.set(task.file, bytes); task.state = 'DONE'; task.onDone?.({}); },
    failWith(error) { task.state = 'FAILED'; task.onError?.({ error }); },
  };
  return task;
}
export function createDownloadTask({ id, destination }) {
  const task = makeTask({ id, file: destination.split('/').pop() });
  created.push(task);
  return task;
}
