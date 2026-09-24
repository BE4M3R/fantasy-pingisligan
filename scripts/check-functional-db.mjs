import { assertCleanDatabase, localClients } from "../tests/functional/fixture.mjs";

try {
  const { admin } = await localClients();
  await assertCleanDatabase(admin);
  console.log("Functional-test database is clean and local.");
} catch (error) {
  console.error(error.message.split("\n")[0]);
  process.exitCode = 1;
}
