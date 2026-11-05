/**
 * Remotion CLI config (marketing/videos/SCRIPTS.md §8 "Package").
 * The sandbox has exactly one Chrome and no route to Remotion's download mirror, so the browser is pinned here
 * and in scripts/render.sh; REMOTION_BROWSER overrides it on a teammate's laptop.
 */
import { Config } from '@remotion/cli/config';

const browser =
  process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

Config.setBrowserExecutable(browser);
// A full Chrome-for-Testing binary (not chrome-headless-shell): run it in its own new-headless mode.
Config.setChromeMode('chrome-for-testing');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
Config.setPixelFormat('yuv420p');
Config.setCodec('h264');
Config.setColorSpace('bt709');
Config.setEntryPoint('src/index.ts');
Config.setPublicDir('public');
