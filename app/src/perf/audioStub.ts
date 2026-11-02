/** Perf Metro only: stands in for expo-audio when the installed native build has no ExpoAudio module. */
const player = () => ({ play() {}, pause() {}, seekTo: async () => {}, remove() {}, volume: 0, loop: false });
export const createAudioPlayer = (_src?: unknown) => player();
export const setAudioModeAsync = async (_mode?: unknown) => {};
export default { createAudioPlayer, setAudioModeAsync };
