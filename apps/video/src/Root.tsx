/**
 * Composition registry (SCRIPTS.md §8 "Compositions"). Every video probes footage/ in calculateMetadata, so
 * a missing capture renders as a labelled placeholder slate rather than failing. Scenes/ holds each RENDERED
 * shot as its own still-able composition; QA/ holds the font probe.
 */
import { Composition, Folder, Still } from 'remotion';

import { captionFiles } from './captions';
import { Frame } from './components/Frame';
import { withFootage } from './components/withFootage';
import { FontProbe } from './compositions/FontProbe';
import {
  JUDGE_FOOTAGE,
  JUDGE_FRAMES,
  JudgeVideo,
  judgeDefaults,
  type JudgeProps,
} from './compositions/JudgeVideo';
import {
  SHORT01_FOOTAGE,
  Short01NoService,
  short01Defaults,
  type Short01Props,
} from './compositions/Short01NoService';
import {
  SHORT02_FOOTAGE,
  Short02Scratch,
  short02Defaults,
  type Short02Props,
} from './compositions/Short02Scratch';
import {
  ReceiptThreeLine,
  SHORT03_FOOTAGE,
  Short03AgentPaid,
  short03Defaults,
  type Short03Props,
} from './compositions/Short03AgentPaid';
import {
  BoardingPassCard,
  SHORT04_FOOTAGE,
  Short04GiftToName,
  short04Defaults,
  type Short04Props,
} from './compositions/Short04GiftToName';
import { CouponScreen, EndCard, IssuingSequence, NotificationCard, UiScreen } from './scenes';
import { seed } from './seed';
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
        calculateMetadata={withFootage<Short01Props>(SHORT01_FOOTAGE)}
      />
      <Composition
        id="Short02Scratch"
        component={Short02Scratch}
        durationInFrames={captionFiles.Short02Scratch.durationInFrames}
        {...PORTRAIT}
        defaultProps={short02Defaults}
        calculateMetadata={withFootage<Short02Props>(SHORT02_FOOTAGE)}
      />
      <Composition
        id="Short03AgentPaid"
        component={Short03AgentPaid}
        durationInFrames={captionFiles.Short03AgentPaid.durationInFrames}
        {...PORTRAIT}
        defaultProps={short03Defaults}
        calculateMetadata={withFootage<Short03Props>(SHORT03_FOOTAGE)}
      />
      <Composition
        id="Short04GiftToName"
        component={Short04GiftToName}
        durationInFrames={captionFiles.Short04GiftToName.durationInFrames}
        {...PORTRAIT}
        defaultProps={short04Defaults}
        calculateMetadata={withFootage<Short04Props>(SHORT04_FOOTAGE)}
      />
      <Composition
        id="JudgeVideo"
        component={JudgeVideo}
        durationInFrames={JUDGE_FRAMES}
        width={1920}
        height={1080}
        fps={FPS}
        defaultProps={judgeDefaults}
        calculateMetadata={withFootage<JudgeProps>(JUDGE_FOOTAGE)}
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
        <Composition
          id="IssuingSequence"
          component={(p: typeof seed.short01 & { sponsorName: string }) => (
            <Frame>
              <UiScreen>
                <IssuingSequence
                  entitlement={p.entitlement}
                  claimTx={p.claimTx}
                  sponsorName={p.sponsorName}
                />
              </UiScreen>
            </Frame>
          )}
          durationInFrames={105}
          {...PORTRAIT}
          defaultProps={{ ...seed.short01, sponsorName: seed.sponsorName }}
        />
        <Composition
          id="ReceiptThreeLine"
          component={(p: { receipt: typeof seed.short03.receipt }) => (
            <Frame>
              <ReceiptThreeLine receipt={p.receipt} />
            </Frame>
          )}
          durationInFrames={90}
          {...PORTRAIT}
          defaultProps={{ receipt: seed.short03.receipt }}
        />
        <Composition
          id="BoardingPassCard"
          component={(p: { pass: typeof seed.short04.pass }) => (
            <Frame>
              <BoardingPassCard pass={p.pass} />
            </Frame>
          )}
          durationInFrames={90}
          {...PORTRAIT}
          defaultProps={{ pass: seed.short04.pass }}
        />
        <Still
          id="AgentPushCard"
          component={(p: typeof seed.short03.push) => (
            <Frame>
              <UiScreen>
                <div style={{ padding: '200px 12px 0' }}>
                  <NotificationCard {...p} />
                </div>
              </UiScreen>
            </Frame>
          )}
          {...PORTRAIT}
          defaultProps={seed.short03.push}
        />
        <Still
          id="CouponScreen"
          component={(p: { state: 'sealed' | 'revealed'; lang: 'en' | 'hi' }) => (
            <Frame>
              <UiScreen>
                <div style={{ padding: '120px 16px 0' }}>
                  <CouponScreen coupon={seed.short02.coupon} state={p.state} lang={p.lang} />
                </div>
              </UiScreen>
            </Frame>
          )}
          {...PORTRAIT}
          defaultProps={{ state: 'revealed', lang: 'en' }}
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
