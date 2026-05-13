import { app, errorHandler, sparqlEscapeUri } from 'mu';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { municipalityLink } from './config/config';

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '1000');
const TIMEOUT = parseInt(process.env.TIMEOUT || '1000');
const LINKING_PRED =
  process.env.LINKING_PRED || 'http://mu.semte.ch/vocabularies/ext/owningBody';

const PREFIXES = `PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
   PREFIX oa: <http://www.w3.org/ns/oa#>
   PREFIX eli: <http://data.europa.eu/eli/ontology#>
   PREFIX org: <http://www.w3.org/ns/org#>
   PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>`;

app.get('/status', function (_req, res) {
  res.send('ok');
});

app.post('/delta', function (_req, res) {
  linkUnlinkedDecisions().catch((e) => {
    console.log(`ERROR: Something went wrong while linking decisions: ${e}`);
  });
  res.send('ok');
});

let running: Date | null = null;
async function linkUnlinkedDecisions() {
  if (running) {
    running = new Date();
    return;
  }
  const myOwnRunning = new Date();
  running = myOwnRunning;

  let count = await countLinkableDecisionsLeft();
  while (count > 0) {
    const batch = await getBatchOfDecisions();
    await linkBatchOfDecisions(batch);
    count = await countLinkableDecisionsLeft();
  }

  await new Promise((resolve) => setTimeout(resolve, TIMEOUT));
  if (running != myOwnRunning) {
    await linkUnlinkedDecisions();
  } else {
    running = null;
  }
}

async function countLinkableDecisionsLeft() {
  const decisionFilter = getDecisionTargetWhere();
  const result = await querySudo(`
   ${PREFIXES}

   SELECT (COUNT(DISTINCT(?decision)) AS ?count) WHERE {
      ?decision a eli:Expression .
      FILTER NOT EXISTS {
        ?decision ${sparqlEscapeUri(LINKING_PRED)} ?target .
      }
      ${decisionFilter}
   } 
  `);
  const count = result?.results.bindings[0].count.value || -1;
  console.log(`Found ${count} linkable decisions`);
  return parseInt(`${count}`);
}

function getDecisionTargetWhere() {
  return municipalityLink;
}

async function linkBatchOfDecisions(decisionUris: string[]) {
  const decisionValues = decisionUris
    .map((d) => {
      return sparqlEscapeUri(d);
    })
    .join('\n');

  const decisionFilter = getDecisionTargetWhere();
  await updateSudo(`
   ${PREFIXES}

   INSERT {
     GRAPH ?graph {
        ?decision ${sparqlEscapeUri(LINKING_PRED)} ?target .
     }
   } WHERE {
      VALUES ?decision {
        ${decisionValues}
      }
      GRAPH ?graph {
        ?decision a eli:Expression .
      }
      FILTER NOT EXISTS {
        ?decision ${sparqlEscapeUri(LINKING_PRED)} ?target .
      }
      ${decisionFilter}
   } 
  `);
}

async function getBatchOfDecisions() {
  const decisionFilter = getDecisionTargetWhere();
  const result = await updateSudo(`
   ${PREFIXES}

   SELECT DISTINCT ?decision WHERE {
      GRAPH ?graph {
        ?decision a eli:Expression .
      }
      FILTER NOT EXISTS {
        ?decision ${sparqlEscapeUri(LINKING_PRED)} ?target .
      }
      ${decisionFilter}
   } LIMIT ${BATCH_SIZE}`);
  return result?.results.bindings.map((b) => b.decision.value) || [];
}

linkUnlinkedDecisions().catch((e) => {
  console.log(`Failed to link unlinked decisions at startup: ${e}`);
});

app.use(errorHandler);
