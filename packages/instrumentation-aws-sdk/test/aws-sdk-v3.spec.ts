// set aws environment variables, so tests in non aws environment are able to run
process.env.AWS_ACCESS_KEY_ID = 'testing';
process.env.AWS_SECRET_ACCESS_KEY = 'testing';

import 'mocha';
import { AwsInstrumentation, NormalizedRequest, NormalizedResponse } from '../src';
import { ReadableSpan, Span } from '@opentelemetry/tracing';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import {
    MessagingDestinationKindValues,
    MessagingOperationValues,
    SemanticAttributes,
} from '@opentelemetry/semantic-conventions';
import { AttributeNames } from '../src/enums';
import expect from 'expect';
import * as fs from 'fs';
import { getTestSpans } from 'opentelemetry-instrumentation-testing-utils';

const region = 'us-east-1';

const instrumentation = new AwsInstrumentation();
instrumentation.enable();
import { PutObjectCommand, PutObjectCommandOutput, S3, S3Client } from '@aws-sdk/client-s3';
import { SQS } from '@aws-sdk/client-sqs';
instrumentation.disable();

import nock from 'nock';

describe('instrumentation-aws-sdk-v3', () => {
    const s3Client = new S3({ region });
    beforeEach(() => {
        instrumentation.enable();
    });

    afterEach(() => {
        instrumentation.disable();
    });

    describe('functional', () => {
        it('promise await', async () => {
            nock(`https://ot-demo-test.s3.${region}.amazonaws.com/`)
                .put('/aws-ot-s3-test-object.txt?x-id=PutObject')
                .reply(200, fs.readFileSync('./test/mock-responses/s3-put-object.xml', 'utf8'));

            const params = { Bucket: 'ot-demo-test', Key: 'aws-ot-s3-test-object.txt' };
            const awsRes = await s3Client.putObject(params);
            expect(getTestSpans().length).toBe(1);
            const [span] = getTestSpans();
            expect(span.attributes[SemanticAttributes.RPC_SYSTEM]).toEqual('aws-api');
            expect(span.attributes[SemanticAttributes.RPC_METHOD]).toEqual('PutObject');
            expect(span.attributes[SemanticAttributes.RPC_SERVICE]).toEqual('S3');
            expect(span.attributes[AttributeNames.AWS_REGION]).toEqual(region);
            expect(span.name).toEqual('S3.PutObject');
        });

        it('callback interface', (done) => {
            nock(`https://ot-demo-test.s3.${region}.amazonaws.com/`)
                .put('/aws-ot-s3-test-object.txt?x-id=PutObject')
                .reply(200, fs.readFileSync('./test/mock-responses/s3-put-object.xml', 'utf8'));

            const params = { Bucket: 'ot-demo-test', Key: 'aws-ot-s3-test-object.txt' };
            s3Client.putObject(params, (err: any, data?: PutObjectCommandOutput) => {
                expect(getTestSpans().length).toBe(1);
                const [span] = getTestSpans();
                expect(span.attributes[SemanticAttributes.RPC_SYSTEM]).toEqual('aws-api');
                expect(span.attributes[SemanticAttributes.RPC_METHOD]).toEqual('PutObject');
                expect(span.attributes[SemanticAttributes.RPC_SERVICE]).toEqual('S3');
                expect(span.attributes[AttributeNames.AWS_REGION]).toEqual(region);
                expect(span.name).toEqual('S3.PutObject');
                done();
            });
        });

        it('use the sdk client style to perform operation', async () => {
            nock(`https://ot-demo-test.s3.${region}.amazonaws.com/`)
                .put('/aws-ot-s3-test-object.txt?x-id=PutObject')
                .reply(200, fs.readFileSync('./test/mock-responses/s3-put-object.xml', 'utf8'));

            const params = { Bucket: 'ot-demo-test', Key: 'aws-ot-s3-test-object.txt' };
            const client = new S3Client({ region });
            await client.send(new PutObjectCommand(params));
            expect(getTestSpans().length).toBe(1);
            const [span] = getTestSpans();
            expect(span.attributes[SemanticAttributes.RPC_SYSTEM]).toEqual('aws-api');
            expect(span.attributes[SemanticAttributes.RPC_METHOD]).toEqual('PutObject');
            expect(span.attributes[SemanticAttributes.RPC_SERVICE]).toEqual('S3');
            expect(span.attributes[AttributeNames.AWS_REGION]).toEqual(region);
            expect(span.name).toEqual('S3.PutObject');
        });

        it('aws error', async () => {
            nock(`https://invalid-bucket-name.s3.${region}.amazonaws.com/`)
                .put('/aws-ot-s3-test-object.txt?x-id=PutObject')
                .reply(403, fs.readFileSync('./test/mock-responses/invalid-bucket.xml', 'utf8'));

            const params = { Bucket: 'invalid-bucket-name', Key: 'aws-ot-s3-test-object.txt' };

            try {
                await s3Client.putObject(params);
            } catch {
                expect(getTestSpans().length).toBe(1);
                const [span] = getTestSpans();

                // expect error attributes
                expect(span.status.code).toEqual(SpanStatusCode.ERROR);
                expect(span.status.message).toEqual('Access Denied');
                expect(span.events.length).toBe(1);
                expect(span.events[0].name).toEqual('exception');

                expect(span.attributes[SemanticAttributes.RPC_SYSTEM]).toEqual('aws-api');
                expect(span.attributes[SemanticAttributes.RPC_METHOD]).toEqual('PutObject');
                expect(span.attributes[SemanticAttributes.RPC_SERVICE]).toEqual('S3');
                expect(span.attributes[AttributeNames.AWS_REGION]).toEqual(region);
                expect(span.attributes[AttributeNames.AWS_REQUEST_ID]).toEqual('MS95GTS7KXQ34X2S');
                expect(span.name).toEqual('S3.PutObject');
            }
        });
    });

    describe('instrumentation config', () => {
        describe('hooks', () => {
            it('verify request and response hooks are called with right params', async () => {
                instrumentation.disable();
                instrumentation.setConfig({
                    preRequestHook: (span: Span, request: NormalizedRequest) => {
                        span.setAttribute('attribute.from.request.hook', request.commandInput.Bucket);
                    },

                    responseHook: (span: Span, response: NormalizedResponse) => {
                        span.setAttribute('attribute.from.response.hook', 'data from response hook');
                    },

                    suppressInternalInstrumentation: true,
                });
                instrumentation.enable();

                nock(`https://ot-demo-test.s3.${region}.amazonaws.com/`)
                    .put('/aws-ot-s3-test-object.txt?x-id=PutObject')
                    .reply(200, fs.readFileSync('./test/mock-responses/s3-put-object.xml', 'utf8'));

                const params = { Bucket: 'ot-demo-test', Key: 'aws-ot-s3-test-object.txt' };
                const awsRes = await s3Client.putObject(params);
                expect(getTestSpans().length).toBe(1);
                const [span] = getTestSpans();
                expect(span.attributes['attribute.from.request.hook']).toEqual(params.Bucket);
                expect(span.attributes['attribute.from.response.hook']).toEqual('data from response hook');
            });

            it('handle throw in request and response hooks', async () => {
                instrumentation.disable();
                instrumentation.setConfig({
                    preRequestHook: (span: Span, request: NormalizedRequest) => {
                        span.setAttribute('attribute.from.request.hook', request.commandInput.Bucket);
                        throw new Error('error from request hook in unittests');
                    },

                    responseHook: (span: Span, response: NormalizedResponse) => {
                        throw new Error('error from response hook in unittests');
                    },

                    suppressInternalInstrumentation: true,
                });
                instrumentation.enable();

                nock(`https://ot-demo-test.s3.${region}.amazonaws.com/`)
                    .put('/aws-ot-s3-test-object.txt?x-id=PutObject')
                    .reply(200, fs.readFileSync('./test/mock-responses/s3-put-object.xml', 'utf8'));

                const params = { Bucket: 'ot-demo-test', Key: 'aws-ot-s3-test-object.txt' };
                const awsRes = await s3Client.putObject(params);
                expect(getTestSpans().length).toBe(1);
                const [span] = getTestSpans();
                expect(span.attributes['attribute.from.request.hook']).toEqual(params.Bucket);
            });
        });

        describe('moduleVersionAttributeName', () => {
            it('setting moduleVersionAttributeName is adding module version', async () => {
                instrumentation.disable();
                instrumentation.setConfig({
                    moduleVersionAttributeName: 'module.version',
                    suppressInternalInstrumentation: true,
                });
                instrumentation.enable();

                nock(`https://ot-demo-test.s3.${region}.amazonaws.com/`)
                    .put('/aws-ot-s3-test-object.txt?x-id=PutObject')
                    .reply(200, fs.readFileSync('./test/mock-responses/s3-put-object.xml', 'utf8'));

                const params = { Bucket: 'ot-demo-test', Key: 'aws-ot-s3-test-object.txt' };
                const awsRes = await s3Client.putObject(params);
                expect(getTestSpans().length).toBe(1);
                const [span] = getTestSpans();

                expect(span.attributes['module.version']).toMatch(/3.\d{1,4}\.\d{1,5}.*/);
            });
        });
    });

    describe('custom service behavior', () => {
        describe('SQS', () => {
            const sqsClient = new SQS({ region });

            it('sqs send add messaging attributes', async () => {
                nock(`https://sqs.${region}.amazonaws.com/`)
                    .post('/')
                    .reply(200, fs.readFileSync('./test/mock-responses/sqs-send.xml', 'utf8'));

                const params = {
                    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/731241200085/otel-demo-aws-sdk',
                    MessageBody: 'payload example from v3 without batch',
                };
                const awsRes = await sqsClient.sendMessage(params);
                expect(getTestSpans().length).toBe(1);
                const [span] = getTestSpans();

                // make sure we have the general aws attributes:
                expect(span.attributes[SemanticAttributes.RPC_SYSTEM]).toEqual('aws-api');
                expect(span.attributes[SemanticAttributes.RPC_METHOD]).toEqual('SendMessage');
                expect(span.attributes[SemanticAttributes.RPC_SERVICE]).toEqual('SQS');
                expect(span.attributes[AttributeNames.AWS_REGION]).toEqual(region);

                // custom messaging attributes
                expect(span.attributes[SemanticAttributes.MESSAGING_SYSTEM]).toEqual('aws.sqs');
                expect(span.attributes[SemanticAttributes.MESSAGING_DESTINATION_KIND]).toEqual(
                    MessagingDestinationKindValues.QUEUE
                );
                expect(span.attributes[SemanticAttributes.MESSAGING_DESTINATION]).toEqual('otel-demo-aws-sdk');
                expect(span.attributes[SemanticAttributes.MESSAGING_URL]).toEqual(params.QueueUrl);
            });

            it('sqs receive add messaging attributes and context', (done) => {
                nock(`https://sqs.${region}.amazonaws.com/`)
                    .post('/')
                    .reply(200, fs.readFileSync('./test/mock-responses/sqs-receive.xml', 'utf8'));

                const params = {
                    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/731241200085/otel-demo-aws-sdk',
                    MaxNumberOfMessages: 3,
                };
                sqsClient.receiveMessage(params).then((res) => {
                    expect(getTestSpans().length).toBe(1);
                    const [span] = getTestSpans();

                    // make sure we have the general aws attributes:
                    expect(span.attributes[SemanticAttributes.RPC_SYSTEM]).toEqual('aws-api');
                    expect(span.attributes[SemanticAttributes.RPC_METHOD]).toEqual('ReceiveMessage');
                    expect(span.attributes[SemanticAttributes.RPC_SERVICE]).toEqual('SQS');
                    expect(span.attributes[AttributeNames.AWS_REGION]).toEqual(region);

                    const receiveCallbackSpan = trace.getSpan(context.active());
                    expect(receiveCallbackSpan).toBeDefined();
                    const attributes = (receiveCallbackSpan as unknown as ReadableSpan).attributes;
                    expect(attributes[SemanticAttributes.MESSAGING_OPERATION]).toMatch(
                        MessagingOperationValues.RECEIVE
                    );
                    done();
                });
            });
        });
    });
});
