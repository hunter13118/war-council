/**
 * Tests for the Benchmark Arena system.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// Test challenge validators directly
describe("Benchmark Challenges", () => {
  it("fizzbuzz validator accepts correct solution", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("fizzbuzz");
    assert.ok(ch, "fizzbuzz challenge exists");

    const good = `function fizzBuzz(n) {
      const arr = [];
      for (let i = 1; i <= n; i++) {
        if (i % 15 === 0) arr.push('FizzBuzz');
        else if (i % 3 === 0) arr.push('Fizz');
        else if (i % 5 === 0) arr.push('Buzz');
        else arr.push(String(i));
      }
      return arr;
    }`;
    assert.ok(ch.validate(good), "correct fizzbuzz passes");
  });

  it("fizzbuzz validator rejects bad solution", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("fizzbuzz");
    assert.ok(!ch.validate("function fizzBuzz(n) { return []; }"), "empty array fails");
  });

  it("binary_search validator works", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("binary_search");
    const good = `function binarySearch(arr, target) {
      let lo = 0, hi = arr.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] === target) return mid;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid - 1;
      }
      return -1;
    }`;
    assert.ok(ch.validate(good));
  });

  it("event_emitter validator works", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("event_emitter");
    const good = `class EventEmitter {
      constructor() { this.listeners = {}; }
      on(event, fn) { (this.listeners[event] = this.listeners[event] || []).push(fn); }
      off(event, fn) { this.listeners[event] = (this.listeners[event] || []).filter(f => f !== fn); }
      emit(event, ...args) { (this.listeners[event] || []).forEach(fn => fn(...args)); }
    }`;
    assert.ok(ch.validate(good));
  });

  it("lru_cache validator works", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("lru_cache");
    const good = `class LRUCache {
      constructor(capacity) { this.cap = capacity; this.map = new Map(); }
      get(key) {
        if (!this.map.has(key)) return -1;
        const v = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, v);
        return v;
      }
      put(key, value) {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.cap) this.map.delete(this.map.keys().next().value);
      }
    }`;
    assert.ok(ch.validate(good));
  });

  it("flatten_array validator works", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("flatten_array");
    const good = `function flatten(arr) { return arr.reduce((acc, v) => acc.concat(Array.isArray(v) ? flatten(v) : v), []); }`;
    assert.ok(ch.validate(good));
  });

  it("deep_clone validator works", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("deep_clone");
    const good = `function deepClone(obj) {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(deepClone);
      const copy = {};
      for (const k of Object.keys(obj)) copy[k] = deepClone(obj[k]);
      return copy;
    }`;
    assert.ok(ch.validate(good));
  });

  it("reverse_linked_list validator works", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("reverse_linked_list");
    const good = `function reverseList(head) {
      let prev = null, curr = head;
      while (curr) { const next = curr.next; curr.next = prev; prev = curr; curr = next; }
      return prev;
    }`;
    assert.ok(ch.validate(good));
  });

  it("debounce validator works", async () => {
    const { getChallengeById } = await import("../benchmark/challenges.js");
    const ch = getChallengeById("debounce");
    const good = `function debounce(fn, ms) {
      let timer;
      return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
    }`;
    assert.ok(ch.validate(good));
  });

  it("getChallengesByDifficulty filters correctly", async () => {
    const { getChallengesByDifficulty } = await import("../benchmark/challenges.js");
    const easy = getChallengesByDifficulty("easy");
    assert.ok(easy.length >= 2, "at least 2 easy challenges");
    assert.ok(easy.every(c => c.difficulty === "easy"));
  });
});

describe("Benchmark Runner", () => {
  it("runChallenge returns structured result on success", async () => {
    const { runChallenge } = await import("../benchmark/runner.js");
    const fakeGenerate = async (prompt) => ({
      text: `function fizzBuzz(n) {
        const arr = [];
        for (let i = 1; i <= n; i++) {
          if (i % 15 === 0) arr.push('FizzBuzz');
          else if (i % 3 === 0) arr.push('Fizz');
          else if (i % 5 === 0) arr.push('Buzz');
          else arr.push(String(i));
        }
        return arr;
      }`,
      model: "test-model",
      elapsedMs: 42,
      tokensOut: 100,
    });

    const result = await runChallenge("fizzbuzz", fakeGenerate);
    assert.equal(result.passed, true);
    assert.equal(result.model, "test-model");
    assert.equal(result.challengeId, "fizzbuzz");
    assert.ok(result.timestamp);
  });

  it("runChallenge returns failed on bad output", async () => {
    const { runChallenge } = await import("../benchmark/runner.js");
    const fakeGenerate = async () => ({ text: "garbage", model: "bad-model", tokensOut: 5 });
    const result = await runChallenge("fizzbuzz", fakeGenerate);
    assert.equal(result.passed, false);
    assert.equal(result.model, "bad-model");
  });

  it("runChallenge strips markdown fences from output", async () => {
    const { runChallenge } = await import("../benchmark/runner.js");
    const fakeGenerate = async () => ({
      text: "```javascript\nfunction binarySearch(arr, target) { let lo=0,hi=arr.length-1; while(lo<=hi) { const mid=(lo+hi)>>>1; if(arr[mid]===target) return mid; if(arr[mid]<target) lo=mid+1; else hi=mid-1; } return -1; }\n```",
      model: "fenced-model",
      tokensOut: 50,
    });
    const result = await runChallenge("binary_search", fakeGenerate);
    assert.equal(result.passed, true);
  });

  it("runSuite runs multiple challenges", async () => {
    const { runSuite } = await import("../benchmark/runner.js");
    let callCount = 0;
    const fakeGenerate = async () => {
      callCount++;
      return { text: "invalid code", model: "suite-model", tokensOut: 1 };
    };
    const results = await runSuite(fakeGenerate, { challengeIds: ["fizzbuzz", "binary_search"] });
    assert.equal(results.length, 2);
    assert.equal(callCount, 2);
  });

  it("getWinRates computes correct rates", async () => {
    const { getWinRates } = await import("../benchmark/runner.js");
    const leaderboard = {
      "model-a": { totalRuns: 10, totalPassed: 8, challenges: {} },
      "model-b": { totalRuns: 10, totalPassed: 5, challenges: {} },
    };
    const rates = getWinRates(leaderboard);
    assert.equal(rates[0].model, "model-a");
    assert.equal(rates[0].winRate, "80.0%");
    assert.equal(rates[1].model, "model-b");
    assert.equal(rates[1].winRate, "50.0%");
  });
});
