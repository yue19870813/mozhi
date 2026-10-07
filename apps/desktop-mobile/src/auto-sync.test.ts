import { describe, expect, it } from 'vitest';
import { AutoSyncSchedule, defaultAutoSync, readAutoSync, writeAutoSync } from './auto-sync';
const enabled = { ...defaultAutoSync, enabled: true };
describe('automatic sync', () => {
  it('is opt-in and isolates persisted settings by vault', () => {
    const data = new Map<string,string>();
    const storage = { getItem: (key:string)=>data.get(key)??null, setItem: (key:string,value:string)=>{data.set(key,value);} };
    writeAutoSync(storage,'a',enabled);
    expect(readAutoSync(storage,'a')).toEqual(enabled);
    expect(readAutoSync(storage,'b').enabled).toBe(false);
    expect(new AutoSyncSchedule(0).due(defaultAutoSync,999999,false)).toBe(false);
    data.set('mozhi-auto-sync-v1:a', '{bad');
    expect(readAutoSync(storage,'a')).toEqual(defaultAutoSync);
    data.set('mozhi-auto-sync-v1:a', JSON.stringify({ enabled:true, idleSeconds:-1, intervalMinutes:0 }));
    expect(readAutoSync(storage,'a')).toEqual(enabled);
  });
  it('persists disabling and prevents every trigger after an in-flight sync completes', () => {
    const data = new Map<string,string>();
    const storage = { getItem: (key:string)=>data.get(key)??null, setItem: (key:string,value:string)=>{data.set(key,value);} };
    writeAutoSync(storage,'a',enabled);
    writeAutoSync(storage,'a',{...enabled,enabled:false});
    const settings=readAutoSync(storage,'a');
    const schedule=new AutoSyncSchedule(0);
    schedule.savedAt=0;
    expect(schedule.due(settings,999999,false)).toBe(false);
    schedule.succeeded(999999);
    schedule.savedAt=1000000;
    expect(schedule.due(settings,1999999,false)).toBe(false);
    expect(settings.enabled).toBe(false);
  });
  it('defers opening sync while blocked and runs it once after becoming idle', () => {
    const schedule=new AutoSyncSchedule(0);
    expect(schedule.due(enabled,1000,true)).toBe(false);
    expect(schedule.due(enabled,1000,false)).toBe(true);
    schedule.succeeded(1000);
    expect(schedule.due(enabled,1001,false)).toBe(false);
  });
  it('waits for the latest save and periodically syncs without local changes', () => {
    const schedule=new AutoSyncSchedule(0);schedule.succeeded(0);
    schedule.savedAt=1000;
    expect(schedule.due(enabled,30000,false)).toBe(false);
    schedule.savedAt=20000;
    expect(schedule.due(enabled,31000,false)).toBe(false);
    expect(schedule.due(enabled,50000,false)).toBe(true);
    schedule.succeeded(50000);
    expect(schedule.due(enabled,349999,false)).toBe(false);
    expect(schedule.due(enabled,350000,false)).toBe(true);
  });
  it('pauses all triggers after failure until a successful manual sync', () => {
    const schedule=new AutoSyncSchedule(0);schedule.paused=true;
    expect(schedule.due(enabled,999999,false)).toBe(false);
    schedule.succeeded(999999);
    expect(schedule.due(enabled,1299999,false)).toBe(true);
  });
  it('respects disabled opening and save triggers', () => {
    const schedule=new AutoSyncSchedule(0);schedule.savedAt=0;
    const settings={...enabled,onOpen:false,afterSave:false};
    expect(schedule.due(settings,60000,false)).toBe(false);
    expect(schedule.due(settings,300000,false)).toBe(true);
  });
});
