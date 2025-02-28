import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  StartIngestionJobCommandInput,
  StartIngestionJobCommandOutput,
} from '@aws-sdk/client-bedrock-agent';
import { S3Event } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const client = new BedrockAgentClient();

export const handler = async ({}: S3Event): Promise<void> => {
  const input: StartIngestionJobCommandInput = {
    knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
    dataSourceId: process.env.DATA_SOURCE_ID,
    clientToken: uuidv4(),
  };
  const command: StartIngestionJobCommand = new StartIngestionJobCommand(input);
  const response: StartIngestionJobCommandOutput = await client.send(command);
  console.log(response);
};
