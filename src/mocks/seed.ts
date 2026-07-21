import { faker } from "@faker-js/faker";

export const defaultMockSeed = 20260721;

export const seedMockData = (seed = defaultMockSeed) => {
  faker.seed(seed);
  faker.setDefaultRefDate("2020-01-01T00:00:00.000Z");
};
