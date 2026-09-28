// What each design is actually called.
//
// The generator names designs "Design 1" through "Design 10" because the source
// catalog called them "Option 1" through "Option 10", which tells a customer
// nothing. These are the real names, written by looking at all 44 photographs.
//
// Keyed by photograph rather than by design id, because the photograph is what
// a design IS. Ids are positional and would silently reattach to the wrong
// design if the generator ever ordered variants differently; a filename cannot.
//
// A name says what you would see if you picked it up. Where two designs share a
// slogan, the name has to carry whatever distinguishes them — the two Hippity
// Hoppity signs differ only in where the frog is sitting, and a customer
// choosing between them needs that in the name rather than in the photograph
// alone.

export const DESIGN_NAMES = Object.freeze({
  /* ---------------------------- Blue Alien Beaded Pen Classics (not fuzzy) */
  'assets/AE4BE61A-5BDA-4493-9EA0-97DB44D77CF0.jpg': 'Scrump on Top, Pink Pearl',
  'assets/1F8C9201-5F03-4D08-A37C-CCC50EDC2020.jpg': 'Little Green Frog',
  'assets/06D786AF-E5B0-4AFB-8C42-78961EE5A17C.jpg': 'Six Arms, Red Sparkle',
  'assets/C2665462-0190-409D-A0E9-923ECE92066F.jpg': 'Orange Gift',
  'assets/19E6E395-7C59-4D65-BB01-7DCAEC823026.jpg': 'Blue Butterfly',
  'assets/DD608410-CC20-425C-820D-50D49D6A324A.jpg': 'Pink Flamingo Float',
  'assets/F4D99A75-36DA-49AC-95AC-91EB2C180991.jpg': 'Aqua Crystal',
  'assets/A2961078-C977-4F2A-857F-67481F51A177.jpg': 'Hula, Green Heart',

  /* ------------------------------------------ Blue Alien Metal Sign Collection */
  'assets/A85BDE9A-0ECB-4E84-B480-42ED001BF94A.jpg': 'Cute Trouble',
  'assets/59989AC5-0FBB-4CA3-A86D-E57B53422C9E.jpg': "Chillin'",
  'assets/8D0031F0-2578-4318-830D-F62B7559588A.jpg': 'Weird But Cute',
  'assets/A5210CA1-CC86-45B9-B7A7-88864CD07885.jpg': 'Hippity Hoppity, Frog in Arms',
  'assets/5C38C215-880B-44A7-9BA8-1183A767719F.jpg': 'Hippity Hoppity, Frog on Head',
  'assets/719E5C45-797F-4FA3-B815-22218349FBDD.jpg': 'Wash Your Hands',
  'assets/B82DAD72-8752-497F-B17C-7164985BFB7D.jpg': "I Don't Do Morning",
  'assets/42424892-07D5-47B7-89EA-2A53D0EED12C.jpg': 'So Not Ordinary',
  'assets/45C87D15-98B9-4F1F-B6AD-88A91532BB9D.jpg': 'Guess What? Stitch Butt!',
  'assets/5BE71561-32F0-4E59-A999-EB682F3CBF56.jpg': 'Ohana Means Family',

  /* ------------------------------------------- Custom Beaded Makeup Brushes */
  'assets/FA35E059-7817-4139-8397-855E6AA78385.jpg': 'Green Hula',
  'assets/D5D424BC-2D84-4950-BB20-062F1DE11456.jpg': 'Pink Angel',
  'assets/68D3FF2B-3F8C-4CC6-A4AA-AF6E9077971A.jpg': 'Blue Butterfly & Pearl',

  /* ------------------------------------------------------ Vinyl Wall Decals */
  'assets/61B2B5C9-0210-4953-AA2D-37DB89AD8F6E.jpg': 'Holding Flowers',
  'assets/DD64E52B-B121-4490-A351-58B658374C42.jpg': 'Painted Sketch',
  'assets/6CB6E722-1225-44FF-AE5F-3B46DCF758E0.jpg': 'Sitting & Waving',

  /* ------------------------------------- Mischievous Blue Alien Keychains */
  'assets/4A414DDE-09C7-4AE0-A696-8F2243D316A6.jpg': 'Stitch & Angel Hearts',
  'assets/AF3C7E24-742D-4845-9B0B-E9923BAB14F0.jpg': 'Unstoppable',
  'assets/095389C8-3D8A-470C-98AC-0F67880EE6DC.jpg': 'So Not Ordinary',
  'assets/6B7CD795-8EB8-4055-AB3A-51B4C568700E.jpg': 'Tiny Stitches, White',
  'assets/C31132C5-21C7-4FF6-A597-6AFA1A7A0BB2.jpg': 'Stitch & the Dragon',

  /* ------------------------------------------- "Fuzzy Friend" Beaded Pens */
  'assets/F9BF3DDB-8823-47C3-B788-14B73EA77C5E.jpg': 'Aqua Floral Heart',
  'assets/CB2CE595-4BDF-4853-A708-A3955C63CE77.jpg': 'Starry Eyes, Blue Glitter',
  'assets/4CFB0276-AEA5-4406-856F-2715CE1BD2DB.jpg': 'Teal Pearl & Gold',
  'assets/741E37D5-9A1E-4C16-9001-84B7B6DC7F1D.jpg': 'Turquoise Crystal',
  'assets/2250234D-DEE2-44F7-90FE-4030BA19DF3B.jpg': 'Pastel Star',

  /* ----------------------------------------------- Car Air Freshener Collection */
  'assets/A4291515-5DD2-4013-8764-FC09A1B2A7DE.jpg': 'Stitch & Scrump, Cream Tassel',
  'assets/A5CEE36F-FA71-4A77-9199-31FDB7B2AF7C.jpg': 'Close-Up Portrait, Blue Tassel',
  'assets/B328CCD2-7823-4CB6-8E3D-27455DBBC9D1.jpg': 'Weird But Cute, Orange',
  'assets/B929036A-A8B2-402B-9FFA-99C0A3CFF2AA.jpg': 'Story Time, Teal Tassel',
  'assets/8AFDE7A4-9E3E-47B7-B50F-ECAF9FE2659A.jpg': 'Pastel Rainbow',
  'assets/57C1DA07-A419-4AFA-AAC6-B2F7F28F146E.jpg': 'Many Faces',
  'assets/52A75398-D6C7-46F9-A32F-C85C368AD93E.jpg': 'Unstoppable, Blue Tassel',

  /* ------------------------------------------- The "Hunny" Beaded Pens */
  'assets/98B66CBA-B4C1-446C-808D-AB4827F2D82F.jpg': 'Eeyore, Purple Glitter',
  'assets/6AE068DA-7041-47FE-BA1D-0684347785EE.jpg': 'Tigger, Gold Glitter',
  'assets/714E0164-1072-41BD-9881-6E41A06E5CBB.jpg': 'Pooh & Balloon',
});

// The shape the generator writes when it has nothing better. Recognising it is
// what lets a real name replace it later without overwriting a name somebody
// actually chose.
export const PLACEHOLDER = /^Design \d+$/;

export const isPlaceholderName = (name) =>
  typeof name !== 'string' || name.trim() === '' || PLACEHOLDER.test(name.trim());

export const nameFor = (image, fallback) => DESIGN_NAMES[image] ?? fallback;
