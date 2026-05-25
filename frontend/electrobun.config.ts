import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Harbor",
    identifier: "com.himanshusardana.harbor",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {},
    copy: {
      "src/views/mainview/index.html": "views/mainview/index.html",
      "src/views/mainview/styles.css": "views/mainview/styles.css",
    },
    mac: {
      bundleCEF: false,
      codesign: false,
      notarize: false,
    },
    linux: {
      bundleCEF: true,
    },
    win: {
      bundleCEF: false,
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
