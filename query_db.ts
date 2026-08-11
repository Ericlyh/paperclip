import postgres from 'postgres';
const sql = postgres('postgres://paperclip:paperclip@127.0.0.1:54329/paperclip');

async function main() {
  try {
    // Check agents table
    const agents = await sql`SELECT id, name, status, company_id FROM agents LIMIT 5`;
    console.log('=== AGENTS ===');
    console.log(JSON.stringify(agents, null, 2));
    
    // Check routines table
    const routines = await sql`SELECT id, title, status FROM routines LIMIT 5`;
    console.log('=== ROUTINES ===');
    console.log(JSON.stringify(routines, null, 2));
    
    // Check agent_api_keys table
    const keys = await sql`SELECT id, agent_id, name FROM agent_api_keys LIMIT 5`;
    console.log('=== AGENT_API_KEYS ===');
    console.log(JSON.stringify(keys, null, 2));
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await sql.end();
  }
}
main();
