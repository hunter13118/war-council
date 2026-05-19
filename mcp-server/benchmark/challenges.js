/**
 * Benchmark challenges — standardized coding tasks for model evaluation.
 * Each challenge has: id, name, difficulty, prompt, validator function.
 */

export const CHALLENGES = [
  {
    id: "fizzbuzz",
    name: "FizzBuzz",
    difficulty: "easy",
    category: "basic",
    prompt: "Write a JavaScript function `fizzBuzz(n)` that returns an array of strings from 1 to n. For multiples of 3, use 'Fizz'. For multiples of 5, use 'Buzz'. For multiples of both, use 'FizzBuzz'. Otherwise use the number as a string.",
    validate: (output) => {
      try {
        const fn = new Function(`${output}\nreturn fizzBuzz(15);`);
        const result = fn();
        return Array.isArray(result) && result[2] === "Fizz" && result[4] === "Buzz" && result[14] === "FizzBuzz" && result[0] === "1";
      } catch { return false; }
    },
  },
  {
    id: "reverse_linked_list",
    name: "Reverse Linked List",
    difficulty: "medium",
    category: "algorithms",
    prompt: "Write a JavaScript function `reverseList(head)` that reverses a singly linked list. Nodes have shape `{ val, next }`. Return the new head.",
    validate: (output) => {
      try {
        const fn = new Function(`${output}\nconst list = {val:1,next:{val:2,next:{val:3,next:null}}};\nconst r = reverseList(list);\nreturn r.val === 3 && r.next.val === 2 && r.next.next.val === 1;`);
        return fn() === true;
      } catch { return false; }
    },
  },
  {
    id: "debounce",
    name: "Debounce Function",
    difficulty: "medium",
    category: "patterns",
    prompt: "Write a JavaScript function `debounce(fn, ms)` that returns a debounced version. The debounced function delays invoking fn until ms milliseconds have elapsed since the last call.",
    validate: (output) => {
      try {
        const fn = new Function(`${output}\nreturn typeof debounce === 'function' && typeof debounce(()=>{}, 100) === 'function';`);
        return fn() === true;
      } catch { return false; }
    },
  },
  {
    id: "binary_search",
    name: "Binary Search",
    difficulty: "easy",
    category: "algorithms",
    prompt: "Write a JavaScript function `binarySearch(arr, target)` that returns the index of target in a sorted array, or -1 if not found. Must be O(log n).",
    validate: (output) => {
      try {
        const fn = new Function(`${output}\nreturn binarySearch([1,3,5,7,9,11], 7) === 3 && binarySearch([1,3,5], 4) === -1;`);
        return fn() === true;
      } catch { return false; }
    },
  },
  {
    id: "deep_clone",
    name: "Deep Clone",
    difficulty: "medium",
    category: "patterns",
    prompt: "Write a JavaScript function `deepClone(obj)` that creates a deep copy of an object. Handle nested objects, arrays, null, and primitives. No need to handle Date/RegExp/Map/Set.",
    validate: (output) => {
      try {
        const fn = new Function(`${output}\nconst o = {a:1,b:{c:[1,2,{d:3}]}};\nconst c = deepClone(o);\nc.b.c[2].d = 99;\nreturn o.b.c[2].d === 3 && c.b.c[2].d === 99;`);
        return fn() === true;
      } catch { return false; }
    },
  },
  {
    id: "event_emitter",
    name: "Event Emitter",
    difficulty: "hard",
    category: "patterns",
    prompt: "Write a JavaScript class `EventEmitter` with methods: `on(event, fn)`, `off(event, fn)`, `emit(event, ...args)`. on() registers a listener, off() removes it, emit() calls all listeners for that event with the given args.",
    validate: (output) => {
      try {
        const fn = new Function(`${output}\nconst ee = new EventEmitter();\nlet x = 0;\nconst handler = (v) => { x += v; };\nee.on('add', handler);\nee.emit('add', 5);\nee.emit('add', 3);\nee.off('add', handler);\nee.emit('add', 100);\nreturn x === 8;`);
        return fn() === true;
      } catch { return false; }
    },
  },
  {
    id: "lru_cache",
    name: "LRU Cache",
    difficulty: "hard",
    category: "data_structures",
    prompt: "Write a JavaScript class `LRUCache` with constructor(capacity) and methods: `get(key)` returns value or -1, `put(key, value)` inserts/updates and evicts least recently used if over capacity.",
    validate: (output) => {
      try {
        const fn = new Function(`${output}\nconst c = new LRUCache(2);\nc.put(1,'a');\nc.put(2,'b');\nconst r1 = c.get(1);\nc.put(3,'c');\nconst r2 = c.get(2);\nreturn r1 === 'a' && r2 === -1;`);
        return fn() === true;
      } catch { return false; }
    },
  },
  {
    id: "flatten_array",
    name: "Flatten Nested Array",
    difficulty: "easy",
    category: "algorithms",
    prompt: "Write a JavaScript function `flatten(arr)` that deeply flattens a nested array. Example: flatten([1,[2,[3,[4]]]]) => [1,2,3,4]",
    validate: (output) => {
      try {
        const fn = new Function(`${output}\nconst r = flatten([1,[2,[3,[4]]],5]);\nreturn JSON.stringify(r) === '[1,2,3,4,5]';`);
        return fn() === true;
      } catch { return false; }
    },
  },
];

export function getChallengeById(id) {
  return CHALLENGES.find(c => c.id === id);
}

export function getChallengesByDifficulty(difficulty) {
  return CHALLENGES.filter(c => c.difficulty === difficulty);
}
