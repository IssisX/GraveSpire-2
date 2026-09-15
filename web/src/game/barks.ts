/**
 * Fear-yelling + expletive line bank for the fall/parachute mechanic.
 *
 * This is a script, not finished audio: `clip` names a file under
 * public/audio/barks/ that does not exist yet -- GameAudio.playClip() is
 * built to no-op silently on a missing file, so this ships correctly today
 * (captions only) and needs no code change the day real recordings land.
 * Captions display through the same flash()-style HUD text every other
 * message in the game already uses -- no new chrome.
 */

export type BarkTrigger = "deploy" | "freefall" | "dive" | "brake" | "land";

export interface BarkLine {
  text: string;
  clip: string;
}

const BANK: Record<BarkTrigger, BarkLine[]> = {
  deploy: [
    { text: "OH SHIT OH SHIT OH— okay. OKAY. That's a parachute. I own a parachute now.", clip: "deploy_01" },
    { text: "CHUTE, CHUTE, CH— oh thank fuck, it opened.", clip: "deploy_02" },
    { text: "I would just like to note, for the record, that this was NOT the plan.", clip: "deploy_03" },
  ],
  freefall: [
    { text: "WHY IS THE GROUND SO FAR AWAY?!", clip: "freefall_01" },
    { text: "THIS WAS A MISTAKE. THIS WAS SUCH A COLOSSAL MISTAKE.", clip: "freefall_02" },
    { text: "I regret every single decision that led to this exact fucking moment!", clip: "freefall_03" },
    { text: "SOMEBODY WRITE THIS DOWN SO I CAN BE EMBARRASSED ABOUT IT LATER!", clip: "freefall_04" },
  ],
  dive: [
    { text: "OKAY THAT'S TOO FAST, THAT'S TOO FA— WHOOOO! SHIT!", clip: "dive_01" },
    { text: "YEAH! YEAH?! — no. No no no, bad idea, BAD IDEA, PULL UP—", clip: "dive_02" },
  ],
  brake: [
    { text: "Slow down slow down SLOW D— okay. Okay, better. My arms are on fire but better.", clip: "brake_01" },
    { text: "This is not what a parachute is aerodynamically for. This is fine. FINE.", clip: "brake_02" },
  ],
  land: [
    { text: "HA! HA HA HA— I'm ALIVE! Let's never do that again. Let's absolutely do that again.", clip: "land_01" },
    { text: "Stuck the landing. Barely. Don't look at my knees.", clip: "land_02" },
    { text: "THAT'S what the fucking chute is for! I'm a professional!", clip: "land_03" },
  ],
};

const lastPicked: Partial<Record<BarkTrigger, string>> = {};

/** A line for this trigger, avoiding an immediate repeat of the last one. */
export function pickBark(trigger: BarkTrigger): BarkLine {
  const lines = BANK[trigger];
  let choice = lines[Math.floor(Math.random() * lines.length)]!;
  if (lines.length > 1 && choice.text === lastPicked[trigger]) {
    choice = lines[(lines.indexOf(choice) + 1) % lines.length]!;
  }
  lastPicked[trigger] = choice.text;
  return choice;
}
