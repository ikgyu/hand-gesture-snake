export const GRID_SIZE = 16;
export const INITIAL_DIRECTION = "RIGHT";
export const SCORE_PER_FOOD = 10;

const DIRECTION_VECTORS = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

const OPPOSITE_DIRECTIONS = {
  UP: "DOWN",
  DOWN: "UP",
  LEFT: "RIGHT",
  RIGHT: "LEFT",
};

export function createInitialState(options = {}) {
  const gridSize = options.gridSize ?? GRID_SIZE;
  const direction = options.direction ?? INITIAL_DIRECTION;
  const snake = options.snake ?? createInitialSnake(gridSize);
  const rng = options.rng ?? Math.random;
  const food = options.food ?? spawnFood(snake, gridSize, rng);

  return {
    gridSize,
    snake: cloneCells(snake),
    direction,
    queuedDirection: direction,
    food: { ...food },
    score: 0,
    isGameOver: false,
  };
}

export function restartGame(options = {}) {
  return createInitialState(options);
}

export function queueDirection(state, nextDirection) {
  if (!DIRECTION_VECTORS[nextDirection] || state.isGameOver) {
    return state;
  }

  const currentDirection = state.queuedDirection ?? state.direction;
  if (OPPOSITE_DIRECTIONS[currentDirection] === nextDirection) {
    return state;
  }

  return {
    ...state,
    queuedDirection: nextDirection,
  };
}

export function stepGame(state, options = {}) {
  if (state.isGameOver) {
    return state;
  }

  const direction = state.queuedDirection ?? state.direction;
  const movement = DIRECTION_VECTORS[direction];
  const head = state.snake[0];
  const nextHead = {
    x: head.x + movement.x,
    y: head.y + movement.y,
  };

  const willEatFood = cellsEqual(nextHead, state.food);
  const bodyToCheck = willEatFood ? state.snake : state.snake.slice(0, -1);

  if (isOutsideBoard(nextHead, state.gridSize) || bodyToCheck.some((cell) => cellsEqual(cell, nextHead))) {
    return {
      ...state,
      direction,
      queuedDirection: direction,
      isGameOver: true,
    };
  }

  const nextSnake = [nextHead, ...cloneCells(state.snake)];
  if (!willEatFood) {
    nextSnake.pop();
  }

  const rng = options.rng ?? Math.random;
  const nextFood = willEatFood ? spawnFood(nextSnake, state.gridSize, rng) : state.food;
  const scorePerFood = options.scorePerFood ?? SCORE_PER_FOOD;

  return {
    ...state,
    snake: nextSnake,
    direction,
    queuedDirection: direction,
    food: nextFood,
    score: state.score + (willEatFood ? scorePerFood : 0),
    isGameOver: false,
  };
}

export function spawnFood(occupiedCells, gridSize, rng = Math.random) {
  const occupied = new Set(occupiedCells.map(toCellKey));
  const availableCells = [];

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const cell = { x, y };
      if (!occupied.has(toCellKey(cell))) {
        availableCells.push(cell);
      }
    }
  }

  if (availableCells.length === 0) {
    return { ...occupiedCells[0] };
  }

  const index = Math.floor(rng() * availableCells.length);
  return availableCells[index];
}

function createInitialSnake(gridSize) {
  const center = Math.floor(gridSize / 2);
  return [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center },
  ];
}

function isOutsideBoard(cell, gridSize) {
  return cell.x < 0 || cell.y < 0 || cell.x >= gridSize || cell.y >= gridSize;
}

function cellsEqual(a, b) {
  return a.x === b.x && a.y === b.y;
}

function toCellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function cloneCells(cells) {
  return cells.map((cell) => ({ ...cell }));
}
