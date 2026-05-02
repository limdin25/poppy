import { execSync } from 'child_process';
import fs from 'fs';

// 6-letter British female names — deep, proper British
const names = [
  // Welsh
  'adwena','aerona','angwen','bethan','carwen','celyns','creirw','derwas',
  'dilwen','dwynwy','eiddwy','eilune','eirian','eirwen','enfysa','ffraid',
  'glains','glenys','glynis','gwenno','hafwen','heledd','heulwy','llinos',
  'manona','maredy','meinir','myfany','tegwen','tirion',

  // Scottish
  'adaira','aileas','annaga','beatha','bonnie','brenna','cairst','davina',
  'donell','doreen','eilidh','finell','gracie','gruoch','ishbel','isobel',
  'kirsty','leslea','lilias','maisie','mhairi','mirren','morven','nairne',
  'rhonda','robina','seonag','sheena','thirza',

  // Properly British — every decade
  'agatha','aileen','amabel','audrey','bertha','bessie','billie','birdie',
  'blythe','bonnie','brenda','brodie','bryony','callie','carmel','carrie',
  'cassie','cherry','cissie','claris','connie','corrie','daphne','debbie',
  'denise','dianne','dollie','dorrie','dulcie','edwina','effies','eileen',
  'elaine','elinor','eunice','evelyn','flossy','fredda','gertie','gladys',
  'glenda','gracie','gwenda','gwenys','hattie','hayley','hedwig','helena',
  'hester','hettie','hilary','honour','isolde','janice','janine','jessie',
  'joanna','judith','juliet','kirsty','kitsey','lavina','leanne','leonie',
  'leslie','lilian','linnet','lottie','louisa','maisie','maudie','maxine',
  'meriel','meryls','millie','minnie','moiras','mollie','muriel','myrtle',
  'nellie','nessie','nicola','noreen','olwena','olivia','pamela','patria',
  'pearle','phylli','pippin','pollie','posies','raquel','rowena','sadie',
  'sallie','sandie','selina','sheila','sylvia','tamsin','thelma','thoras',
  'trixie','trudie','ursula','valery','velvet','violet','vivian','yvette',
  'yvonne','zelena',

  // Cornish
  'beryna','demelz','derwas','elowen','hedras','hendry','kerens','kerra',
  'lamorn','loveda','lowena','meraud','morven','morwen','newlyn','rosena',
  'serana','sterer','tamara','tamsin','tressa','ygerna','ysella',

  // Modern British — Love Island era
  'alesha','amelia','callie','caylin','cheska','chriss','collee','darcey',
  'delpha','ellies','elvina','emilys','franki','gemmas','georgi','gillys',
  'hallie','harley','harlow','harper','indigo','isobel','janine','jessie',
  'kaylee','laceys','leylas','libbys','lottie','lolita','lorena','marise',
  'meigan','millie','naomir','nikita','nolana','perrie','phoebe','reggae',
  'shelby','sienna','sinead','stevie','summer','tracey','wallis','yasmin',

  // Actually 6-letter names that are real and British
  'agatha','aileen','amabel','anabel','astrid','audrey','aurora','avalon',
  'ayleth','beatty','bessie','bianca','biddie','billie','birdie','bonnie',
  'brenda','brigid','bridie','briony','bryony','callie','carmel','carrie',
  'cassie','cecile','cecily','cherry','chrisy','claire','connie','corina',
  'daphne','darcie','debbie','delyth','denise','dianne','dimple','dollie',
  'donnas','dorrie','dottie','dulcie','edwina','eileen','elaine','elinor',
  'elodie','elvira','emilia','eunice','evelyn','fatima','flavia','flower',
  'franky','frieda','gaynor','gertie','gladys','glenda','glynis','gracie',
  'gwenda','hattie','hayley','hedwig','helena','hermia','hester','hettie',
  'hilary','honour','imelda','isolde','janice','janine','jessie','joanna',
  'joanne','joella','josefa','judith','juliet','karena','kirsty','laurel',
  'lavina','layla','leanne','leonie','lesley','lilian','lilith','linnet',
  'lottie','louisa','maisie','margot','marian','maxine','melina','meriel',
  'millie','minnie','miriam','mollie','muriel','myrtle','nadine','nellie',
  'nerida','nessie','nicola','noelle','noreen','odette','olivia','ottava',
  'pamela','petula','phoebe','portia','raquel','regina','renata','rhonda',
  'robina','romany','rowena','roxana','sabina','salome','selena','selina',
  'serena','sheena','sheila','shelby','sherry','shirly','simone','sinead',
  'sophia','stella','stevie','summer','sylvia','tamara','tamsin','tanith',
  'taylor','teresa','thelma','thalia','trixie','trudie','ursula','valery',
  'vanity','venita','violet','vivian','wallis','winona','yvette','yvonne',
  'zarena','zelena','zenith','zinnia',

  // Regional/unusual but known British
  'ardath','athena','bethel','bidget','blanch','blithe','cerise','charis',
  'cobina','colina','dagmar','damita','davida','dearie','delpha','deneen',
  'dessie','dorcas','edythe','eithne','elnora','elvina','elvira','emilia',
  'erlina','essien','eulogy','falcon','fennel','fergie','garnet','gianna',
  'glynda','gwynne','halcyn','hepsey','honora','hydria','ilaria','ingrid',
  'ivette','jarvis','jessye','joelle','jolene','kaelin','kaylin','keelin',
  'kieran','kinsey','lainie','lanita','larkin','lassie','laurie','lawrie',
  'lenora','lexine','lilias','lizbet','loella','loreen','lorena','lovedy',
  'lucile','lynsey','marcia','marina','marisa','marley','meadow','melody',
  'melvyn','mercia','merlyn','mignon','myriam','nadira','noelle','odessa',
  'orchid','pandys','pearla','pippin','polina','porina','priory','quincy',
  'radley','ramona','regine','reveka','richel','romily','roslyn','rowina',
  'sabine','salena','sandie','sarika','shirin','sidony','silver','simona',
  'sioban','skylar','spring','starla','tahlia','tallis','tandie','taresa',
  'thalia','thirza','tottle','trilby','tullia','ulrica','undine','urania',
  'vashti','velvet','verity','vienna','winola','winter','xanthe','yasmin',
  'yeoman','zarena','zenith','zinnia','zuzana',
];

const uniqueNames = [...new Set(names)];
// Keep only 6-letter names
const sixLetterNames = uniqueNames.filter(n => n.length === 6);
const candidates = sixLetterNames.map(n => `hey${n}.com`);

// Shuffle
for (let i = candidates.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
}

// Load already-found
let alreadyFound = [];
try {
  alreadyFound = fs.readFileSync('/Users/hugo/Whats/Poppy/available-hey-names.txt', 'utf8').trim().split('\n');
} catch {}
const alreadySet = new Set(alreadyFound);

console.log(`6-letter names: ${sixLetterNames.length}`);
console.log(`Candidates: ${candidates.length}`);
console.log(`Skipping ${alreadySet.size} already found\n`);

const available = [];
const GOAL = 100;
let checked = 0;
let taken = 0;

function checkVeriSign(domain) {
  try {
    const result = execSync(
      `whois -h whois.verisign-grs.com ${domain} 2>/dev/null`,
      { timeout: 10000, encoding: 'utf8', maxBuffer: 256 * 1024 }
    );
    if (result.includes('No match for')) return 'available';
    if (result.includes('Domain Name:')) return 'taken';
    if (result.includes('RATE LIMIT')) return 'rate_limited';
    return 'unknown';
  } catch {
    return 'error';
  }
}

const startTime = Date.now();

for (const domain of candidates) {
  if (available.length >= GOAL) break;
  if (alreadySet.has(domain)) continue;

  checked++;
  const status = checkVeriSign(domain);

  if (status === 'available') {
    available.push(domain);
    console.log(`✓ ${domain} (${available.length}/${GOAL})`);
  } else if (status === 'taken') {
    taken++;
  } else if (status === 'rate_limited') {
    console.log('⏳ Rate limited, waiting 15s...');
    execSync('sleep 15');
    checked--;
    continue;
  }

  if (checked % 100 === 0) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`[${checked}] ${elapsed}s | ✓ ${available.length} | ✗ ${taken}`);
  }

  if (checked % 2 === 0) execSync('sleep 0.3');
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
console.log(`\nDone — ${elapsed}s | Checked: ${checked} | Available: ${available.length} | Taken: ${taken}`);

const allDomains = [...alreadyFound, ...available];
fs.writeFileSync('/Users/hugo/Whats/Poppy/available-hey-names.txt', allDomains.join('\n') + '\n');

console.log(`\nAvailable:`);
available.forEach(d => console.log(`  ${d}`));
