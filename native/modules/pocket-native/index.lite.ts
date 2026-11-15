// For an update sent to a build of the app made before this module existed:
// everything is absent, and says so.

export const hasNative = false;
export const beginBackgroundWork = async (_title: string, _subtitle: string) => 'none' as 'continued' | 'short' | 'none';
export const backgroundProgress = (_fraction: number) => {};
export const endBackgroundWork = (_success = true) => {};
export const backgroundTimeRemaining = async () => 0;
export const onBackgroundExpire = (_listener: () => void) => ({ remove() {} });
export const pdfText = async (_uri: string) => '';
export const imageText = async (_uri: string) => '';
export const torch = async (_level: number) => false;
export const screenBrightness = async (_level: number) => -1;
export const alarm = async (_on: boolean) => false;
export const serveFolder = async (_directory: string): Promise<string | null> => null;
export const stopServing = () => {};
