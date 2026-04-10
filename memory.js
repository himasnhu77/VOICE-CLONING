const neo4j = require("neo4j-driver");

const driver = neo4j.driver(
  "bolt://localhost:7687",
  neo4j.auth.basic("neo4j", "password123")
);

// ─── Save SELECTIVE memory (only important facts) ─────────────────────────────
// Called only when AI decides the message is worth remembering.
// Stores: user facts (name, job, preference) or interests — NOT full messages.
async function saveSelectiveMemory(sessionId, fact, type, reason) {
  const session = driver.session();
  try {
    await session.run(`
      MERGE (s:Session {id: $sessionId})
      CREATE (m:Memory {
        content:   $fact,
        type:      $type,
        reason:    $reason,
        timestamp: datetime()
      })
      MERGE (s)-[:HAS_MEMORY]->(m)
    `, { sessionId, fact, type, reason });

    // If it's a user_fact, also create a UserFact node for easy querying
    if (type === "user_fact") {
      await session.run(`
        MERGE (s:Session {id: $sessionId})
        MERGE (f:UserFact {content: $fact})
        ON CREATE SET f.createdAt = datetime()
        MERGE (s)-[:KNOWS]->(f)
      `, { sessionId, fact });
    }

    // If it's an interest, create an Interest node
    if (type === "interest") {
      await session.run(`
        MERGE (s:Session {id: $sessionId})
        MERGE (i:Interest {name: $fact})
        ON CREATE SET i.count = 1
        ON MATCH  SET i.count = i.count + 1
        MERGE (s)-[:INTERESTED_IN]->(i)
      `, { sessionId, fact });
    }

  } finally {
    await session.close();
  }
}

// ─── Save full conversation memory (used as fallback if needed) ───────────────
async function saveMemory(sessionId, userMsg, aiReply, agentUsed) {
  const session = driver.session();
  try {
    await session.run(`
      MERGE (s:Session {id: $sessionId})
      CREATE (u:Message {role:"user",      content:$userMsg,  timestamp:datetime()})
      CREATE (a:Message {role:"assistant", content:$aiReply, agent:$agentUsed, timestamp:datetime()})
      MERGE (s)-[:HAS_MESSAGE]->(u)
      MERGE (s)-[:HAS_MESSAGE]->(a)
      MERGE (u)-[:REPLIED_BY]->(a)
    `, { sessionId, userMsg, aiReply, agentUsed });
  } finally {
    await session.close();
  }
}

// ─── Recall selective memories for a session ─────────────────────────────────
// Returns only the important facts — keeps context window small & relevant
async function recallMemory(sessionId, limit = 20) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Session {id: $sessionId})-[:HAS_MEMORY]->(m:Memory)
      RETURN m.content AS content, m.type AS type, m.reason AS reason
      ORDER BY m.timestamp DESC LIMIT $limit
    `, { sessionId, limit: neo4j.int(limit) });

    return result.records.map(r => ({
      content: r.get("content"),
      type:    r.get("type"),
      reason:  r.get("reason"),
    }));
  } finally {
    await session.close();
  }
}

// ─── Recall user interests for a session ─────────────────────────────────────
async function recallRelatedTopics(sessionId) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Session {id: $sessionId})-[:INTERESTED_IN]->(i:Interest)
      RETURN i.name AS topic, i.count AS count
      ORDER BY i.count DESC LIMIT 10
    `, { sessionId });

    return result.records.map(r => r.get("topic"));
  } finally {
    await session.close();
  }
}

// ─── Get all sessions ─────────────────────────────────────────────────────────
async function getAllSessions() {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Session)
      OPTIONAL MATCH (s)-[:HAS_MEMORY]->(m:Memory)
      RETURN s.id AS id, count(m) AS memCount
      ORDER BY s.id DESC LIMIT 20
    `);
    return result.records.map(r => ({
      id:       r.get("id"),
      memCount: r.get("memCount").toNumber()
    }));
  } finally {
    await session.close();
  }
}

// ─── Get graph data for visualisation ────────────────────────────────────────
async function getGraphData() {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (n)-[r]->(m)
      RETURN
        id(n) AS sourceId, labels(n)[0] AS sourceLabel,
        coalesce(n.id, n.content, n.name, '') AS sourceName,
        type(r) AS relation,
        id(m) AS targetId, labels(m)[0] AS targetLabel,
        coalesce(m.id, m.content, m.name, '') AS targetName
      LIMIT 150
    `);

    const nodes = new Map();
    const links = [];

    result.records.forEach(rec => {
      const sId = rec.get("sourceId").toString();
      const tId = rec.get("targetId").toString();

      if (!nodes.has(sId)) nodes.set(sId, {
        id:    sId,
        label: rec.get("sourceLabel"),
        name:  rec.get("sourceName").slice(0, 40)
      });
      if (!nodes.has(tId)) nodes.set(tId, {
        id:    tId,
        label: rec.get("targetLabel"),
        name:  rec.get("targetName").slice(0, 40)
      });

      links.push({ source: sId, target: tId, type: rec.get("relation") });
    });

    return { nodes: [...nodes.values()], links };
  } finally {
    await session.close();
  }
}

async function closeDriver() { await driver.close(); }

module.exports = {
  saveMemory,
  saveSelectiveMemory,
  recallMemory,
  recallRelatedTopics,
  getAllSessions,
  getGraphData,
  closeDriver,
};