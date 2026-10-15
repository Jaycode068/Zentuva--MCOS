const fs = require('fs');
const crypto = require('crypto');
const { createRequire } = require('module');
const req = createRequire(process.cwd() + '/package.json');
req('ts-node/register/transpile-only');
const { PrismaClient } = req('@prisma/client');
const guard = req('./src/testing/test-db-guard');
req('./test/load-test-env').loadTestEnvFile();
const which = process.argv[2];
const url = which === 'test' ? guard.requireTestDatabaseUrl() : process.env.DATABASE_URL;
const u = new URL(url);
if (!['localhost','127.0.0.1'].includes(u.hostname)) throw new Error('Nonlocal host rejected');
const prisma = new PrismaClient({datasources:{db:{url}}});
async function main() {
  if(which === 'test') await guard.verifyConnectedToTestDatabase(prisma);
  const result = {target:which, endpoint:{host:u.hostname,port:u.port,database:u.pathname.slice(1),role:decodeURIComponent(u.username)}};
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    result.identity = await tx.$queryRawUnsafe('SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS server_address, inet_server_port() AS internal_port, version() AS version');
    result.roles = await tx.$queryRawUnsafe("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN ('zentuva','zentuva_test','zentuva_test_app','zentuva_test_admin') ORDER BY rolname");
    result.migrations = await tx.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at,applied_steps_count FROM _prisma_migrations ORDER BY migration_name');
    result.organisations = await tx.organisation.findMany({select:{id:true,name:true,slug:true}});
    const tables = await tx.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    result.tables = {};
    for (const {tablename} of tables) {
      const quoted = '"'+tablename.replace(/"/g,'""')+'"';
      const rows = await tx.$queryRawUnsafe('SELECT row_to_json(t)::text AS row FROM '+quoted+' t');
      const sorted = rows.map(r=>r.row).sort();
      result.tables[tablename]={count:rows.length,sha256:crypto.createHash('sha256').update(sorted.join('\n')).digest('hex')};
    }
    result.periods = await tx.accountingPeriod.findMany({select:{organisationId:true,name:true,status:true,startDate:true,endDate:true}});
  },{isolationLevel:'RepeatableRead',timeout:60000});
  fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({target:which,endpoint:result.endpoint,identity:result.identity,roles:result.roles,organisations:result.organisations,migrations:result.migrations.length,tables:Object.keys(result.tables).length,counts:result.tables.consumer_conversations}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
