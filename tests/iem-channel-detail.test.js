import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelDetail, mountChannelDetail } from '../src/iem/channel-detail.js';
import { landscapeColumns, channelSlots } from '../src/iem/channel-layout.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';
import { projectLiveState } from '../src/iem/live-provider.js';
import { domFixture, Node } from './helpers/fake-dom.js';

test('even landscape capacities retain canonical order and adjacent received pairs, including leading group master', () => {
  assert.deepEqual([390,650,820,1150].map(landscapeColumns), [2,6,8,10]);
  const pair = (a,b) => [{sourceId:a,levelPeerIds:[a,b]}, {sourceId:b,levelPeerIds:[a,b]}];
  const models = [{kind:'group'}, ...pair('i.0','i.1'), ...pair('i.2','i.3'), ...pair('i.4','i.5')];
  const before = structuredClone(models);
  assert.deepEqual(channelSlots(models,6),[1,2,3,4,5,7,8]);
  assert.deepEqual(channelSlots(models.slice(1),6),[1,2,3,4,5,6]);
  assert.deepEqual(models,before);
  const unverified = [{sourceId:'i.0'}, {sourceId:'i.1'}];
  assert.deepEqual(channelSlots([{}, {}, {}, {}, {}, ...unverified],6),[1,2,3,4,5,6,7]);
});
const model = { id:'i.0@0', sourceId:'i.0', name:'<unsafe>', detail:'Linked with Input 2', requestedDetail:'Requested .8; application unverified', sides:[{auxIndex:0,position:.25049,levelText:'−12 dB',panPosition:.50049,stateText:'Send mute: Unknown · Pre-fader'}, {auxIndex:1,position:.3,panPosition:.5004,stateText:'Muted · Post-processing'}], meter:{label:'Source post-fader VU · NOT AUX send',status:'missing',values:[],provenance:'library scale; firmware unverified'} };
test('touch and keyboard reachable detail retains exact per-side actuals, unknowns and requested distinction', () => {
  const detail = channelDetail(model);
  for (const expected of ['.25049','.50049','.5004','Unknown','Pre-fader','Muted','Post-processing','Requested .8','NOT AUX send','firmware unverified']) assert.ok(detail.includes(expected), expected);
  const app=domFixture(), owner=createDialogOwner(); let cancels=0;
  const ui=mountChannelDetail({root:app.root,dialogOwner:owner,onOpen:()=>{ cancels++; }});
  app.root.querySelector('.mm-brand').focus(); const before=app.document.activeElement;
  ui.open(model); assert.equal(cancels,1); assert.equal(app.document.activeElement,app.close); assert.equal(app.layer.hidden,false); assert.equal(app.title.textContent,'<unsafe> · Details');
  ui.update([{...model,name:'New name',requestedDetail:'Requested .9'}]); assert.equal(app.title.textContent,'New name · Details'); assert.match(app.body.textContent,/Requested .9/);
  app.root.emit('keydown',{key:'Escape'}); assert.equal(app.layer.hidden,true); assert.equal(app.document.activeElement,before);
  ui.open(model); ui.update([]); assert.equal(app.layer.hidden,true);
});
test('detail replacement and stale close callbacks cannot close another owner or restore obsolete focus', () => {
  const app=domFixture(), owner=createDialogOwner(); const ui=mountChannelDetail({root:app.root,dialogOwner:owner});
  ui.open(model); const stale=[...app.close.handlers.get('click')];
  const replacement=owner.claim('pan',()=>{}); app.layer.hidden=false;
  stale.forEach(fn=>fn({stopImmediatePropagation(){}}));
  assert.equal(owner.owns(replacement),true); assert.equal(app.layer.hidden,false);
  assert.equal(app.root.handlers.get('keydown').length,0);
});

test('master and relative-group detail never claim a source meter or manufacture received group actuals', () => {
  const master = channelDetail({name:'Mix',position:.5,meter:{label:'Output post-fader VU',status:'missing'}});
  assert.match(master,/Output VU is post-fader/); assert.doesNotMatch(master,/Source VU|undefined/);
  const group = channelDetail({kind:'group',detail:'2 members',stateText:'Relative delta'});
  assert.match(group,/no aggregate actual level, group VU/); assert.doesNotMatch(group,/Received level|Received pan|Source VU/);
});


test('wired Details opening retains inactive requested paths and current canceled outcome through meter publication', () => {
  const app = domFixture(), owner = createDialogOwner(), sockets = [];
  const old = Object.fromEntries(['document','window','matchMedia','innerHeight','ResizeObserver'].map(key => [key,globalThis[key]]));
  Object.assign(globalThis,{ document:app.document,window:new Node(app.document),matchMedia:()=>({matches:true}),innerHeight:844,ResizeObserver:class {observe(){} disconnect(){}} });
  class Socket { readyState=0;sent=[];constructor(){sockets.push(this);}send(message){this.sent.push(message);}close(){this.readyState=3;} }
  const timers={setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){}};
  const session=createAuxControlSession({WebSocketClass:Socket,timers,now:()=>0,wallNow:()=>0});
  let detail;
  const project=()=>projectLiveState(session.snapshot(),0);
  const view=mountReadOnlyView(app.root,{ onOpenDetail:model=>detail.open(model),onDetailUpdate:models=>detail?.update(models),canEditLevel:target=>session.canEditLevelTarget(target) });
  detail=mountChannelDetail({root:app.root,dialogOwner:owner,onOpen:model=>{ session.invalidateLevelContext(); view.render(project()); return view.detailModel(model.id); }});
  const off=session.subscribe(()=>view.render(project()));
  try {
    session.connect('192.168.0.60');
    for(const socket of sockets){socket.readyState=1;socket.onopen();}
    sockets[1].onmessage({data:'3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.5\nSETD^a.1.mix^0.5\nSETD^i.0.stereoIndex^-1\nSETD^i.0.aux.0.value^0.3\nSETD^i.0.aux.1.value^0.3'});
    session.selectLevelTarget({kind:'send',sourceId:'i.0',auxIndex:0});
    const token=session.beginLevelGesture();session.previewLevelGesture(token,.7);session.commitLevelGesture(token,.7);
    assert.equal(session.snapshot().control.pending,true);
    const button=app.root.querySelector('.mm-strip-scroll').querySelector('.mm-detail-button');
    button.focus();button.emit('click');
    assert.match(app.body.textContent,/Last requested \(inactive\).*i.0.aux.0.value=0.7.*i.0.aux.1.value=0.7/s);
    assert.doesNotMatch(app.body.textContent,/Waiting for fresh observations/);
    assert.match(app.body.textContent,/cancelled|cancel|Returned/);
    const diagnostic=app.body.textContent;
    view.renderMeters(project());assert.equal(app.body.textContent,diagnostic);
    assert.equal(sockets[0].sent.filter(message=>message.startsWith('3:::SETD')).length,2);
    app.root.emit('keydown',{key:'Escape'});assert.equal(app.document.activeElement,button);
  } finally {off();view.destroy();session.disconnect();for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
