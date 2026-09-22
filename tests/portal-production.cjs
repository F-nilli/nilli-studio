const {test}=require('node:test');const assert=require('node:assert/strict');const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
function load(imports){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/portal/production.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:m.exports,require:n=>imports[n],Date,URL});return m.exports}
class PortalError extends Error{constructor(status,message){super(message);this.status=status}}
const p=load({'./store':{},'./core':{PortalError}});
test('project metadata cannot override completion; only safe links and review readiness are written',()=>{const d=p.projectDetails({review_ready:false,published:true,published_at:'2099-01-01'});assert.equal(d.published_at,undefined);assert.equal(d.published,undefined);assert.throws(()=>p.projectDetails({review_ready:true}));});
test('client links reject script URLs, credentials and lookalike Frame.io domains',()=>{assert.equal(p.projectUrl('https://f.io/abc',true),'https://f.io/abc');assert.equal(p.projectUrl('https://app.frame.io/reviews/abc',true),'https://app.frame.io/reviews/abc');for(const url of ['javascript:alert(1)','http://frame.io/x','https://frame.io.evil.test/x','https://user:pass@frame.io/x'])assert.throws(()=>p.projectUrl(url,true));});
test('project reads always filter by verified client, reject bad page inputs and choose current before latest',async()=>{const calls=[];const responses=[{data:[],count:0},{data:[],count:0},{data:[{id:'latest'}],count:1}];const q={};for(const name of ['select','eq','is','in','not','order','range','gte','lt','or'])q[name]=(...args)=>{calls.push([name,...args]);return q};q.limit=async()=>responses.shift();const h=load({'./core':{PortalError},'./store':{db:()=>({from:()=>q}),check:e=>{if(e)throw e}}});assert.equal((await h.projectFeed('verified-client','home')).project.id,'latest');assert.equal(calls.filter(c=>c[0]==='eq'&&c[1]==='portal_client_id'&&c[2]==='verified-client').length,3);assert.ok(calls.some(c=>c[0]==='in'&&c[1]==='status'));await assert.rejects(h.projectFeed('a','library',-1));await assert.rejects(h.projectFeed('a','invalid'));});
test('archive and restore drive Library; isolation, legacy migration and stable origins remain protected',async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table users(id uuid primary key);create table clients(id uuid primary key,key text);
 create table portal_clients(id uuid primary key,active boolean default true);
 create table episodes(id uuid primary key,client_key text,template_name text,guest_name text,release_date date,release_time time,created_at timestamptz default now(),archived boolean default false,completed_at timestamptz,published_at timestamptz);
 create table portal_client_templates(production_client_id uuid references clients(id) on delete cascade,template_name text,portal_client_id uuid references portal_clients(id),primary key(production_client_id,template_name));
 insert into clients values('00000000-0000-0000-0000-000000000001','walker'),('00000000-0000-0000-0000-000000000002','other');
 insert into portal_clients(id) values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
 insert into portal_client_templates values('00000000-0000-0000-0000-000000000001','Default','10000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002','Default','10000000-0000-0000-0000-000000000002');
 insert into episodes(id,client_key,guest_name,release_date,archived,completed_at,published_at) values('20000000-0000-0000-0000-000000000001','walker','Completed but unpublished','2026-09-10',true,now(),now());`);
 const migration=fs.readFileSync('supabase/migration_portal_production.sql','utf8');await db.exec(migration);await db.exec(migration);
 let rows=(await db.query('select * from portal_project_feed')).rows;assert.equal(rows[0].status,'awaiting_publication');assert.equal(rows[0].published_at,null);assert.equal(rows[0].portal_client_id,'10000000-0000-0000-0000-000000000001');assert.equal(rows[0].notes,undefined);
 await assert.rejects(db.query("select portal_save_project('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','{}',null)"));
 await db.query(`select portal_save_project('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','{"review_ready":false,"published_at":"2020-01-01"}',null)`);assert.equal((await db.query('select status from portal_project_feed')).rows[0].status,'published');

 const sync=fs.readFileSync('supabase/migration_portal_completion_sync.sql','utf8');await db.exec(sync);await db.exec(sync);
 assert.equal((await db.query('select status from portal_project_feed')).rows[0].status,'published');
 // Reopening must remove Library membership even if a manual portal flag remains.
 await db.exec("update episodes set archived=false,completed_at=null,published_at=null");
 assert.equal((await db.query('select status,published_at from portal_project_feed')).rows[0].status,'in_progress');
 assert.equal((await db.query('select published_at from portal_project_feed')).rows[0].published_at,null);
 // Both automatic and manual completion flow through this same archive update.
 await db.exec("update episodes set archived=true,completed_at='2026-01-02',published_at='2026-01-02'");
 assert.equal((await db.query('select status from portal_project_feed')).rows[0].status,'published');
 await db.query(`select portal_save_project('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','{"review_ready":false,"published_at":null}',null)`);
 assert.equal((await db.query('select status from portal_project_feed')).rows[0].status,'published');
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from portal_project_feed'));await assert.rejects(db.query('select * from portal_project_details'));await db.exec('reset role');
 await db.query("delete from portal_client_templates where production_client_id='00000000-0000-0000-0000-000000000001'");assert.equal((await db.query('select * from portal_project_feed')).rows.length,0);
 await db.query("delete from clients where key='walker'");await db.query("insert into clients values('00000000-0000-0000-0000-000000000003','walker')");await db.query("insert into portal_client_templates values('00000000-0000-0000-0000-000000000003','Default','10000000-0000-0000-0000-000000000002')");assert.equal((await db.query('select * from portal_project_feed')).rows.length,0);
 await db.exec(migration);await db.exec(sync);assert.equal((await db.query('select * from portal_project_feed')).rows.length,0);
 await db.exec("insert into episodes(id,client_key,guest_name,release_date) values('20000000-0000-0000-0000-000000000002','walker','New project','2026-09-21')");assert.equal((await db.query('select * from portal_project_feed')).rows[0].title,'New project');
 await db.exec("create table workspace_settings(timezone text);insert into workspace_settings values('America/Montreal')");
 const dashboard=fs.readFileSync('supabase/migration_portal_dashboard.sql','utf8');await db.exec(dashboard);await db.exec(dashboard);
 await db.exec("update episodes set release_date='2026-07-01',release_time='15:00' where guest_name='New project'");
 assert.equal(new Date((await db.query('select release_at from portal_project_feed')).rows[0].release_at).toISOString(),'2026-07-01T19:00:00.000Z');
 await db.exec("update episodes set release_timezone='Europe/Paris' where guest_name='New project'");
 assert.equal(new Date((await db.query('select release_at from portal_project_feed')).rows[0].release_at).toISOString(),'2026-07-01T13:00:00.000Z');
 await db.exec("update episodes set release_date='2026-01-01' where guest_name='New project'");
 assert.equal(new Date((await db.query('select release_at from portal_project_feed')).rows[0].release_at).toISOString(),'2026-01-01T14:00:00.000Z');
 await db.exec("update episodes set release_time=null where guest_name='New project'");assert.equal((await db.query('select release_at from portal_project_feed')).rows[0].release_at,null);
 await db.exec("set role authenticated");await assert.rejects(db.query('select * from portal_client_packages'));await db.exec('reset role');
 await db.close();
});
