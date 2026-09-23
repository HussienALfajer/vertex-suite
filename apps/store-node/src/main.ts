import { composeStoreNode } from './store-node.js';

const database = process.env['VERTEX_POSTGRES_URL'];
const schema = process.env['VERTEX_SCHEMA'];
const attachmentsDirectory = process.env['VERTEX_ATTACHMENTS_DIR'];
const tenant = process.env['VERTEX_TENANT'];
const handle = process.env['VERTEX_OWNER_HANDLE'];
const password = process.env['VERTEX_OWNER_PASSWORD'];
const port = Number(process.env['PORT'] ?? '5182');

if (
  !database ||
  !schema ||
  !attachmentsDirectory ||
  !tenant ||
  !handle ||
  !password ||
  !Number.isInteger(port) ||
  port < 0 ||
  port > 65_535
) {
  throw new Error(
    'Store-node needs VERTEX_POSTGRES_URL, VERTEX_SCHEMA, VERTEX_ATTACHMENTS_DIR, VERTEX_TENANT, VERTEX_OWNER_HANDLE, VERTEX_OWNER_PASSWORD and a valid PORT.',
  );
}

const node = await composeStoreNode({ connectionString: database, schema, attachmentsDirectory });
try {
  await node.provisionTenant(
    tenant as Parameters<typeof node.provisionTenant>[0],
    handle,
    password,
  );
  const listener = await node.listen(port, process.env['HOST'] ?? '127.0.0.1');
  const address = listener.address();
  if (!address || typeof address === 'string')
    throw new Error('Store-node did not bind a TCP port.');
  console.log(`STORE_NODE_PORT=${String(address.port)}`);
  const shutdown = async (): Promise<void> => {
    await node.close();
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
} catch (cause) {
  await node.close();
  throw cause;
}
