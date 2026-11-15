// First aid and survival basics that are part of the app itself: they open
// with no model loaded, no library and no signal. They are also handed to the
// model when a question is plainly about one of them, so that its answer rests
// on these steps and not on what a small model half remembers.
//
// They follow the common ground of the main first aid bodies (St John
// Ambulance, the Red Cross, the NHS, the American Heart Association). They are
// a reminder for someone with nothing better to hand, not training and not a
// doctor.
//
// Nothing here touches the phone, so the tests use it as it is.

export type Card = {
  id: string;
  title: string;
  /** How to know this is what is happening. */
  signs?: string;
  steps: string[];
  /** What not to do. */
  never?: string[];
  /** Words in a question that mean it is about this. */
  about: RegExp;
  group: 'first aid' | 'survival';
};

export const CALL = 'Call 999 or 112 (911 in North America)';

export const CARDS: Card[] = [
  {
    id: 'cpr', group: 'first aid', title: 'Not breathing (CPR)',
    signs: 'They do not respond when you shake their shoulders and shout, and they are not breathing normally.',
    steps: [
      `${CALL}, or have someone else call, and ask for a defibrillator (AED) to be brought.`,
      'Lay them on their back on something firm.',
      'Put the heel of one hand on the centre of their chest and your other hand on top. Lock your elbows.',
      'Push down hard, 5 to 6 cm, and let the chest come back up. Do this twice a second.',
      'If you are trained to, give 2 rescue breaths after every 30 pushes. If not, just keep pushing.',
      'If a defibrillator arrives, switch it on and do what it says.',
      'Keep going until help takes over or they start breathing normally. Swap with someone else every 2 minutes if you can.',
    ],
    never: ['Do not stop to check for a pulse.', 'Do not worry about hurting them: pushing too gently is the danger.'],
    about: /\b(cpr|not breathing|stopped breathing|isn'?t breathing|no pulse|cardiac arrest|chest compressions?|heart (has )?stopped|defibrillator|unresponsive and not)\b/i,
  },
  {
    id: 'cpr-child', group: 'first aid', title: 'Child or baby not breathing',
    signs: 'They do not respond and are not breathing normally.',
    steps: [
      `${CALL}, or have someone else call.`,
      'Tilt the head back gently and give 5 rescue breaths first: seal your mouth over their mouth (and nose, for a baby) and blow gently until the chest rises.',
      'Child over 1: push on the centre of the chest with one hand, down by a third of the depth of the chest, twice a second.',
      'Baby under 1: push with two fingers on the centre of the chest, down by a third of its depth, twice a second.',
      'After every 30 pushes give 2 rescue breaths. Keep going until help takes over.',
    ],
    about: /\b(baby|infant|child|toddler|kid)\b.*\b(not breathing|stopped breathing|isn'?t breathing|cpr|unresponsive)\b|\b(cpr)\b.*\b(baby|infant|child|toddler)\b/i,
  },
  {
    id: 'choking', group: 'first aid', title: 'Choking',
    signs: 'They cannot speak, cough or breathe, and may be clutching their throat.',
    steps: [
      'If they can cough, tell them to keep coughing. Do nothing else yet.',
      'If they cannot: stand behind and to one side, lean them forward, and give up to 5 sharp blows between the shoulder blades with the heel of your hand.',
      'Still stuck: stand behind them, put a fist just above their belly button, hold it with your other hand, and pull sharply in and up. Up to 5 times.',
      `Still stuck: ${CALL.toLowerCase()}, and keep going with 5 back blows, then 5 pulls.`,
      'If they go limp and stop responding, lay them down and start CPR.',
    ],
    never: [
      'Do not do the pulls on a baby under 1 or on someone who is pregnant: push on the breastbone instead.',
      'Do not feel around in their mouth for something you cannot see.',
    ],
    about: /\b(chok(e|es|ed|ing)|heimlich|something stuck in (his|her|their|my) throat|abdominal thrusts?|back blows?)\b/i,
  },
  {
    id: 'bleeding', group: 'first aid', title: 'Heavy bleeding',
    signs: 'Blood is pouring or spurting, or soaking through whatever is on the wound.',
    steps: [
      'Press hard on the wound with a clean cloth, or your hand if there is nothing else. Keep pressing.',
      `${CALL}.`,
      'If blood soaks through, put more cloth on top and press harder. Leave the first cloth where it is.',
      'If it is an arm or a leg and pressing does not stop it: tie a tourniquet 5 to 7 cm above the wound (not on a joint), tighten it until the bleeding stops, and note the time.',
      'Lay them down, keep them warm, and keep pressing until help comes.',
    ],
    never: ['Do not pull out anything stuck in the wound: press on both sides of it.', 'Do not loosen a tourniquet once it is on.'],
    about: /\b(bleeding|bleed|blood (is )?(pouring|spurting|everywhere)|tourniquet|deep cut|stab(bed)?|gunshot|severed|haemorrhag\w*|hemorrhag\w*)\b/i,
  },
  {
    id: 'burns', group: 'first aid', title: 'Burns and scalds',
    steps: [
      'Hold the burn under cool or lukewarm running water for 20 minutes. Start as soon as you can.',
      'Take off clothing and jewellery near the burn, unless it is stuck to the skin.',
      'Cover it loosely with cling film or a clean plastic bag. A clean cloth that does not shed fluff will do.',
      'Keep the rest of them warm.',
      `Get medical help if the burn is bigger than their hand, deep or white or charred, on the face, hands, feet, joints or genitals, from chemicals or electricity, or the person is a child or elderly. ${CALL} if it is severe.`,
    ],
    never: ['No ice, butter, creams or toothpaste.', 'Do not burst blisters.'],
    about: /\b(burn(s|t|ed|ing)?|scald(s|ed)?|boiling water on)\b/i,
  },
  {
    id: 'recovery', group: 'first aid', title: 'Unconscious but breathing',
    signs: 'They do not respond, but when you tilt their head back and watch for 10 seconds, they are breathing normally.',
    steps: [
      'Kneel beside them. Put the arm nearest you straight out from their body.',
      'Bring their far arm across their chest and hold the back of that hand against the cheek nearest you.',
      'With your other hand, pull their far knee up so the foot is flat on the ground.',
      'Pull on the knee to roll them towards you onto their side.',
      'Tilt their head back a little so the airway stays open and anything in the mouth can drain out.',
      `${CALL}. Stay and keep checking their breathing. If it stops, start CPR.`,
    ],
    never: ['If they may have hurt their neck or back, do not move them unless you must to keep them breathing.'],
    about: /\b(unconscious|passed out|fainted|collapsed|unresponsive|recovery position|won'?t wake)\b/i,
  },
  {
    id: 'stroke', group: 'first aid', title: 'Stroke',
    signs: 'Face: one side droops, they cannot smile evenly. Arms: they cannot hold both arms up. Speech: slurred or muddled.',
    steps: [
      `Any one of those signs: ${CALL.toLowerCase()} straight away. Minutes matter.`,
      'Note the time the signs started and tell the crew.',
      'Keep them still and comfortable, lying with head and shoulders slightly raised.',
      'If they stop responding but are breathing, put them in the recovery position.',
    ],
    never: ['Give them nothing to eat or drink.', 'Do not wait to see if it passes.'],
    about: /\b(stroke|face (is )?droop\w*|slurred speech|one side of (his|her|their|my) (face|body))\b/i,
  },
  {
    id: 'heart', group: 'first aid', title: 'Heart attack',
    signs: 'Pain, pressure or tightness in the chest that may spread to an arm, the neck, jaw, back or stomach. Sweating, breathlessness, feeling sick or faint.',
    steps: [
      `${CALL}.`,
      'Sit them down, leaning back with knees bent, and keep them calm and still.',
      'If they are an adult and not allergic to aspirin, have them slowly chew one 300 mg aspirin.',
      'If they have their own angina spray or tablets, help them take it.',
      'If they stop responding and are not breathing normally, start CPR.',
    ],
    about: /\b(heart attack|chest pain|pain in (his|her|their|my) chest|tight(ness)? in (his|her|their|my) chest)\b/i,
  },
  {
    id: 'allergy', group: 'first aid', title: 'Severe allergic reaction',
    signs: 'Swelling of the lips, tongue or throat. Struggling to breathe or swallow, wheezing. Faint, clammy, confused. Often a rash, after a sting, food or medicine.',
    steps: [
      'If they have an adrenaline auto-injector (EpiPen, Jext, Emerade), use it now: press it into the outer middle of the thigh, through clothes if need be, and hold it as its label says.',
      `${CALL} and say "anaphylaxis".`,
      'Lay them down with legs raised. If breathing is hard, let them sit up. If pregnant, lay them on their left side.',
      'No better after 5 minutes: use a second injector if there is one, in the other thigh.',
      'If they stop responding and are not breathing normally, start CPR.',
    ],
    never: ['Do not let them stand or walk, even if they feel better.'],
    about: /\b(anaphyla\w+|allergic reaction|epipen|epi-pen|throat (is )?(closing|swelling)|stung by a (bee|wasp)|bee sting)\b/i,
  },
  {
    id: 'seizure', group: 'first aid', title: 'Seizure (fit)',
    steps: [
      'Note the time it starts.',
      'Move hard or sharp things away and put something soft under their head.',
      'Loosen anything tight round their neck.',
      'When the jerking stops, roll them into the recovery position and stay with them while they come round.',
      `${CALL} if it lasts more than 5 minutes, another follows, it is their first, they are hurt, pregnant or diabetic, or they do not come round.`,
    ],
    never: ['Do not hold them down.', 'Do not put anything in their mouth.'],
    about: /\b(seizure|having a fit|fitting|convuls\w+|epilep\w+)\b/i,
  },
  {
    id: 'cold', group: 'first aid', title: 'Hypothermia (too cold)',
    signs: 'Shivering, cold pale skin, slurred speech, clumsy, confused, very tired. Shivering that stops is a bad sign.',
    steps: [
      'Get them out of the wind and wet: indoors, a tent, a car, behind anything.',
      'Take off wet clothes and wrap them in dry layers, blankets or a sleeping bag. Cover the head. Put something between them and the ground.',
      'Share body heat if there is nothing else.',
      'If they are awake, give warm sweet drinks and food.',
      `${CALL}. Handle them gently and keep them lying down.`,
    ],
    never: ['No alcohol.', 'Do not rub their arms and legs, or use a hot bath or direct heat.'],
    about: /\b(hypothermia|freezing|frostbite|too cold|shivering|fell (in|into|through) (the )?(ice|water|river|lake))\b/i,
  },
  {
    id: 'heat', group: 'first aid', title: 'Heatstroke (too hot)',
    signs: 'Very hot skin, confusion, headache, dizziness, fast pulse, being sick. They may have stopped sweating.',
    steps: [
      'Move them somewhere cool and shaded and lay them down.',
      'Cool them fast: take off outer clothes, wet their skin with cool water and fan them. Put anything cold at the neck, armpits and groin.',
      `${CALL} if they are confused, fitting, not responding, or no better after 30 minutes.`,
      'If they are awake, give sips of water.',
    ],
    about: /\b(heat ?stroke|heat exhaustion|overheat(ed|ing)?|sunstroke|too hot)\b/i,
  },
  {
    id: 'poison', group: 'first aid', title: 'Swallowed something harmful',
    steps: [
      `${CALL}, or a poisons line, and say what was taken, how much and when.`,
      'Keep the container or a sample to show.',
      'If it burned their lips or mouth, give sips of water or milk.',
      'If they stop responding but are breathing, put them in the recovery position.',
    ],
    never: ['Do not make them sick.'],
    about: /\b(poison(ed|ing|ous)?|overdos\w+|swallowed (bleach|pills|tablets|a battery|something)|drank (bleach|antifreeze))\b/i,
  },
  {
    id: 'bones', group: 'first aid', title: 'Broken bones and sprains',
    steps: [
      'Keep the injured part still and support it in the position you found it, with padding, a sling or by hand.',
      'Put something cold, wrapped in cloth, on it for up to 20 minutes.',
      'Cover any wound with a clean dressing.',
      `${CALL} if bone shows, the limb is bent out of shape, numb, cold or pale, or the injury is to the neck, back, hip or thigh.`,
    ],
    never: ['Do not try to straighten it.', 'With a neck or back injury, do not move them unless they are in danger.'],
    about: /\b(broken (arm|leg|bone|ankle|wrist|rib|hip|collarbone)|fractur\w+|sprain\w*|dislocat\w+|twisted (my|his|her|their) ankle)\b/i,
  },
  {
    id: 'sugar', group: 'first aid', title: 'Low blood sugar (diabetes)',
    signs: 'Someone with diabetes who is shaky, sweaty, pale, hungry, confused or behaving oddly.',
    steps: [
      'If they are awake and can swallow, give something sugary now: a small glass of fruit juice or a sugary drink (not diet), 4 or 5 glucose tablets or sweets.',
      'Wait 10 to 15 minutes. No better: give the same again.',
      'Once they are better, give something that lasts: a sandwich, biscuits, their next meal.',
      `${CALL} if they do not improve or stop responding. If they are not responding but breathing, put them in the recovery position.`,
    ],
    never: ['Do not put food or drink in the mouth of someone who is not awake.'],
    about: /\b(low blood sugar|hypoglyc\w+|diabetic (is|and)|having a hypo)\b/i,
  },
  {
    id: 'calling', group: 'survival', title: 'Calling for help with no signal',
    steps: [
      'Try the emergency number anyway. An emergency call may use any network in range, not only your own.',
      'On iPhone 14 or later with no coverage at all, try the call outdoors under open sky: the phone offers Emergency SOS by satellite.',
      'Hold the side button and a volume button to bring up Emergency SOS without unlocking.',
      'If a call will not hold, text someone who can call for you: a text gets through on a signal too weak for a call.',
      'Higher, open ground gets signal that a valley or building blocks.',
      'Tell them where you are (the coordinates on this screen), what has happened, and how many people.',
    ],
    about: /\b(no signal|no reception|no coverage|can'?t (call|get through)|call for help|emergency sos|satellite sos)\b/i,
  },
  {
    id: 'signal', group: 'survival', title: 'Being found',
    steps: [
      'Stay where you are if people know roughly where you went. Searchers start from there.',
      'Three of anything is the sign for distress: three whistle blasts, three flashes, three shouts, three fires. Then pause and repeat.',
      'SOS is three short, three long, three short. The torch on this screen flashes it for you.',
      'Make yourself big and bright in the open: bright clothes laid out, a signal fire with green leaves for smoke by day.',
      'At night a light carries much further than a voice. A mirror or a phone screen can flash sunlight by day.',
      'Save your voice and your battery: signal in bursts, on the hour.',
    ],
    about: /\b(lost in the (woods|forest|mountains|desert|wild\w*)|get rescued|signal for help|i'?m lost|we'?re lost|stranded)\b/i,
  },
  {
    id: 'water', group: 'survival', title: 'Making water safe to drink',
    steps: [
      'Let cloudy water settle and pour off the clear part, or strain it through cloth.',
      'Boil it: one minute at a full rolling boil (three minutes high in the mountains). This is the surest way.',
      'No way to boil: add plain unscented household bleach, 2 drops to a litre (4 if the water is cloudy), stir, and wait 30 minutes. It should smell faintly of chlorine.',
      'Water purification tablets: follow the packet.',
      'Running water is safer than still water, and rain you catch yourself is safest of all.',
    ],
    never: ['Do not drink sea water or urine.', 'Do not go thirsty to save water: drink what you need and look for more.'],
    about: /\b(purify(ing)? water|safe to drink|drinking water|boil(ing)? water|water purification|clean water)\b/i,
  },
  {
    id: 'priorities', group: 'survival', title: 'What to do first when stranded',
    steps: [
      'Stop. Sit down, breathe, and do not walk on in a hurry. Most people who are lost make it worse by moving.',
      'Treat injuries.',
      'Shelter comes before water, and water before food: cold or heat can kill in hours, thirst in about three days, hunger in weeks.',
      'Get out of wind, rain and sun, and off the bare ground. Stay dry.',
      'Find water and make it safe.',
      'Make yourself easy to find, and stay put unless you are sure of the way.',
    ],
    about: /\b(surviv(e|al|ing) (in|if|when|without)|stranded|shelter (from|in)|build a shelter)\b/i,
  },
  {
    id: 'battery', group: 'survival', title: 'Making the phone last',
    steps: [
      'Turn on Low Power Mode (Settings, Battery) and turn the screen brightness down.',
      'With no signal, turn on Airplane Mode: hunting for a network drains the battery fastest. GPS still works in Airplane Mode.',
      'Close this app when you are not using it, and use the smallest model: a reply costs far more power than reading a card.',
      'Keep the phone warm, against your body. Cold empties a battery quickly.',
      'Use it at set times, not constantly. Write down what matters (coordinates, numbers) on paper if you can.',
    ],
    about: /\b(save (my |the )?(phone )?battery|battery (is )?(dying|low|running out)|make (my|the) (phone|battery) last)\b/i,
  },
];

/** A card as plain text: for the model to answer from, and for sharing. */
export function cardText(card: Card): string {
  return [
    card.title,
    card.signs ? `Signs: ${card.signs}` : '',
    'What to do:',
    ...card.steps.map((step, i) => `${i + 1}. ${step}`),
    card.never?.length ? `Never: ${card.never.join(' ')}` : '',
  ].filter(Boolean).join('\n');
}

/** The cards a question is plainly about, the most specific first. At most two. */
export function cardsFor(question: string): Card[] {
  const text = question.slice(0, 400);
  const found = CARDS.filter((card) => card.about.test(text));
  // A child who is not breathing is the child's card, not the adult's as well.
  const specific = found.some((c) => c.id === 'cpr-child') ? found.filter((c) => c.id !== 'cpr') : found;
  return specific.slice(0, 2);
}
