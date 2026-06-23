importScripts("/vendor/occt/occt-import-js.js");

let occtReady = null;

function getOcct() {
  if (!occtReady) {
    occtReady = occtimportjs({
      locateFile(path) {
        return `/vendor/occt/${path}`;
      },
    });
  }

  return occtReady;
}

self.onmessage = async (event) => {
  try {
    const { buffer, params } = event.data;
    const occt = await getOcct();
    const result = occt.ReadStepFile(new Uint8Array(buffer), params ?? null);

    if (!result || result.success !== true) {
      throw new Error("STEP 文件解析失败");
    }

    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
