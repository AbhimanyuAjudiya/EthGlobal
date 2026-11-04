/**
 * Composition registry (SCRIPTS.md §8 "Compositions"). Every video probes footage/ (human captures) and
 * footage/screen/ (headless captures of the PWA) in calculateMetadata, so a missing capture renders as a
 * labelled placeholder slate rather than failing. Scenes/ holds the end card; QA/ holds the font probe.
 */
import { Composition, Folder, Still } from 'remotion';

import { captionFiles } from './captions';
import { Frame } from './components/Frame';
import { withFootage } from './components/withFootage';
import { FontProbe } from './compositions/FontProbe';
import {
  JUDGE_FOOTAGE,
  JUDGE_FRAMES,
  JUDGE_SCREENS,
  JudgeVideo,
  judgeDefaults,
  type JudgeProps,
} from './compositions/JudgeVideo';
import {
  SHORT01_FOOTAGE,
  SHORT01_SCREENS,
  Short01NoService,
  short01Defaults,
  type Short01Props,
} from './compositions/Short01NoService';
import {
  SHORT02_FOOTAGE,
  SHORT02_SCREENS,
  Short02Scratch,
  short02Defaults,
  type Short02Props,
} from './compositions/Short02Scratch';
import {
  SHORT03_FOOTAGE,
  SHORT03_SCREENS,
  Short03AgentPaid,
  short03Defaults,
  type Short03Props,
} from './compositions/Short03AgentPaid';
import {
  SHORT04_FOOTAGE,
  SHORT04_SCREENS,
  Short04GiftToName,
  short04Defaults,
  type Short04Props,
} from './compositions/Short04GiftToName';
import { EndCard } from './scenes';
import { FPS } from './theme';

const PORTRAIT = { width: 1080, height: 1920, fps: FPS } as const;

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="Short01NoService"
        component={Short01NoService}
        durationInFrames={captionFiles.Short01NoService.durationInFrames}
        {...PORTRAIT}
        defaultProps={short01Defaults}
        calculateMetadata={withFootage<Short01Props>(SHORT01_FOOTAGE, SHORT01_SCREENS)}
      />
      <Composition
        id="Short02Scratch"
        component={Short02Scratch}
        durationInFrames={captionFiles.Short02Scratch.durationInFrames}
        {...PORTRAIT}
        defaultProps={short02Defaults}
        calculateMetadata={withFootage<Short02Props>(SHORT02_FOOTAGE, SHORT02_SCREENS)}
      />
      <Composition
        id="Short03AgentPaid"
        component={Short03AgentPaid}
        durationInFrames={captionFiles.Short03AgentPaid.durationInFrames}
        {...PORTRAIT}
        defaultProps={short03Defaults}
        calculateMetadata={withFootage<Short03Props>(SHORT03_FOOTAGE, SHORT03_SCREENS)}
      />
      <Composition
        id="Short04GiftToName"
        component={Short04GiftToName}
        durationInFrames={captionFiles.Short04GiftToName.durationInFrames}
        {...PORTRAIT}
        defaultProps={short04Defaults}
        calculateMetadata={withFootage<Short04Props>(SHORT04_FOOTAGE, SHORT04_SCREENS)}
      />
      <Composition
        id="JudgeVideo"
        component={JudgeVideo}
        durationInFrames={JUDGE_FRAMES}
        width={1920}
        height={1080}
        fps={FPS}
        defaultProps={judgeDefaults}
        calculateMetadata={withFootage<JudgeProps>(JUDGE_FOOTAGE, JUDGE_SCREENS)}
      />
      <Folder name="Scenes">
        <Composition
          id="EndCard"
          component={(p: { line: string }) => (
            <Frame>
              <EndCard line={p.line} />
            </Frame>
          )}
          durationInFrames={60}
          {...PORTRAIT}
          defaultProps={{ line: "300 MB · because you're human" }}
        />
      </Folder>
      <Folder name="QA">
        <Still
          id="FontProbe"
          component={FontProbe}
          width={1080}
          height={1080}
          defaultProps={{ mode: 'product' }}
        />
      </Folder>
    </>
  );
}
