import 'mocha';
import { AwsInstrumentation } from '../src';
import { ReadableSpan, Span } from '@opentelemetry/tracing';
import { SpanStatusCode } from '@opentelemetry/api';
import { AttributeNames } from '../src/enums';
import { mockAwsSend } from './testing-utils';
import { getTestSpans } from 'opentelemetry-instrumentation-testing-utils';
import expect from 'expect';

const instrumentation = new AwsInstrumentation();
instrumentation.enable();
import AWS from 'aws-sdk';
instrumentation.disable();

describe('instrumentation-aws-sdk-v2', () => {
    const responseMockSuccess = {
        requestId: '0000000000000',
        error: null,
    };

    const responseMockWithError = {
        requestId: '0000000000000',
        error: 'something went wrong',
    };

    const getAwsSpans = (): ReadableSpan[] => {
        return getTestSpans().filter((s) => s.instrumentationLibrary.name.includes('aws-sdk'));
    };

    before(() => {
        AWS.config.credentials = {
            accessKeyId: 'test key id',
            expired: false,
            expireTime: null,
            secretAccessKey: 'test acc key',
            sessionToken: 'test token',
        };
    });

    beforeEach(() => {
        instrumentation.disable();
        instrumentation.enable();
    });

    afterEach(() => {
        instrumentation.disable();
    });

    describe('functional', () => {
        describe('successful send', () => {
            before(() => {
                mockAwsSend(responseMockSuccess);
                instrumentation.disable();
                instrumentation.enable();
            });

            it('adds proper number of spans with correct attributes', async () => {
                const s3 = new AWS.S3();
                const bucketName = 'aws-test-bucket';
                const keyName = 'aws-test-object.txt';
                await new Promise((resolve) => {
                    // span 1
                    s3.createBucket({ Bucket: bucketName }, async function (err, data) {
                        const params = {
                            Bucket: bucketName,
                            Key: keyName,
                            Body: 'Hello World!',
                        };
                        // span 2
                        s3.putObject(params, function (err, data) {
                            if (err) console.log(err);
                            resolve({});
                        });
                    });
                });

                const awsSpans = getAwsSpans();
                expect(awsSpans.length).toBe(2);
                const [spanCreateBucket, spanPutObject] = awsSpans;

                expect(spanCreateBucket.attributes[AttributeNames.AWS_OPERATION]).toBe('createBucket');
                expect(spanCreateBucket.attributes[AttributeNames.AWS_SIGNATURE_VERSION]).toBe('s3');
                expect(spanCreateBucket.attributes[AttributeNames.AWS_SERVICE_API]).toBe('S3');
                expect(spanCreateBucket.attributes[AttributeNames.AWS_SERVICE_IDENTIFIER]).toBe('s3');
                expect(spanCreateBucket.attributes[AttributeNames.AWS_SERVICE_NAME]).toBe('Amazon S3');
                expect(spanCreateBucket.attributes[AttributeNames.AWS_REQUEST_ID]).toBe(responseMockSuccess.requestId);
                expect(spanCreateBucket.attributes[AttributeNames.AWS_REGION]).toBe('us-east-1');

                expect(spanCreateBucket.name).toBe('S3.CreateBucket');

                expect(spanPutObject.attributes[AttributeNames.AWS_OPERATION]).toBe('putObject');
                expect(spanPutObject.attributes[AttributeNames.AWS_SIGNATURE_VERSION]).toBe('s3');
                expect(spanPutObject.attributes[AttributeNames.AWS_SERVICE_API]).toBe('S3');
                expect(spanPutObject.attributes[AttributeNames.AWS_SERVICE_IDENTIFIER]).toBe('s3');
                expect(spanPutObject.attributes[AttributeNames.AWS_SERVICE_NAME]).toBe('Amazon S3');
                expect(spanPutObject.attributes[AttributeNames.AWS_REQUEST_ID]).toBe(responseMockSuccess.requestId);
                expect(spanPutObject.attributes[AttributeNames.AWS_REGION]).toBe('us-east-1');
                expect(spanPutObject.name).toBe('S3.PutObject');
            });

            it('adds proper number of spans with correct attributes if both, promise and callback were used', async () => {
                const s3 = new AWS.S3();
                const bucketName = 'aws-test-bucket';
                const keyName = 'aws-test-object.txt';
                await new Promise((resolve) => {
                    // span 1
                    s3.createBucket({ Bucket: bucketName }, async function (err, data) {
                        const params = {
                            Bucket: bucketName,
                            Key: keyName,
                            Body: 'Hello World!',
                        };

                        let reqPromise: Promise<any> | null = null;
                        let numberOfCalls = 0;
                        const cbPromise = new Promise(async (resolveCb) => {
                            // span 2
                            const request = s3.putObject(params, function (err, data) {
                                if (err) console.log(err);
                                numberOfCalls++;
                                if (numberOfCalls === 2) {
                                    resolveCb({});
                                }
                            });
                            // NO span
                            reqPromise = request.promise();
                        });

                        await Promise.all([cbPromise, reqPromise]).then(() => {
                            resolve({});
                        });
                    });
                });

                const awsSpans = getAwsSpans();
                expect(awsSpans.length).toBe(2);
                const [spanCreateBucket, spanPutObjectCb] = awsSpans;
                expect(spanCreateBucket.attributes[AttributeNames.AWS_OPERATION]).toBe('createBucket');
                expect(spanPutObjectCb.attributes[AttributeNames.AWS_OPERATION]).toBe('putObject');
                expect(spanPutObjectCb.attributes[AttributeNames.AWS_REGION]).toBe('us-east-1');
            });

            it('adds proper number of spans with correct attributes if only promise was used', async () => {
                const s3 = new AWS.S3();
                const bucketName = 'aws-test-bucket';
                const keyName = 'aws-test-object.txt';
                await new Promise((resolve) => {
                    // span 1
                    s3.createBucket({ Bucket: bucketName }, async function (err, data) {
                        const params = {
                            Bucket: bucketName,
                            Key: keyName,
                            Body: 'Hello World!',
                        };

                        let reqPromise: Promise<any> | null = null;
                        // NO span
                        const request = s3.putObject(params);
                        // span 2
                        await request.promise();
                        resolve({});
                    });
                });

                const awsSpans = getAwsSpans();
                expect(awsSpans.length).toBe(2);
                const [spanCreateBucket, spanPutObjectCb] = awsSpans;
                expect(spanCreateBucket.attributes[AttributeNames.AWS_OPERATION]).toBe('createBucket');
                expect(spanPutObjectCb.attributes[AttributeNames.AWS_OPERATION]).toBe('putObject');
                expect(spanPutObjectCb.attributes[AttributeNames.AWS_REGION]).toBe('us-east-1');
            });

            it('should create span if no callback is supplied', (done) => {
                const s3 = new AWS.S3();
                const bucketName = 'aws-test-bucket';

                s3.putObject({
                    Bucket: bucketName,
                    Key: 'key name from tests',
                    Body: 'Hello World!',
                }).send();

                setImmediate(() => {
                    const awsSpans = getAwsSpans();
                    expect(awsSpans.length).toBe(1);
                    done();
                });
            });
        });

        describe('send return error', () => {
            before(() => {
                mockAwsSend(responseMockWithError);
                instrumentation.disable();
                instrumentation.enable();
            });

            it('adds error attribute properly', async () => {
                const s3 = new AWS.S3();
                const bucketName = 'aws-test-bucket';
                await new Promise((resolve) => {
                    s3.createBucket({ Bucket: bucketName }, async function () {
                        resolve({});
                    });
                });

                const awsSpans = getAwsSpans();
                expect(awsSpans.length).toBe(1);
                const [spanCreateBucket] = awsSpans;
                expect(spanCreateBucket.attributes[AttributeNames.AWS_ERROR]).toBe(responseMockWithError.error);
            });
        });
    });

    describe('instrumentation config', () => {
        it('preRequestHook called and add request attribute to span', (done) => {
            mockAwsSend(responseMockSuccess, 'data returned from operation');
            const config = {
                preRequestHook: (span: Span, request: any) => {
                    span.setAttribute('attribute from hook', request.commandInput['Bucket']);
                },
            };

            instrumentation.disable();
            instrumentation.setConfig(config);
            instrumentation.enable();

            const s3 = new AWS.S3();
            const bucketName = 'aws-test-bucket';

            s3.createBucket({ Bucket: bucketName }, async function (err, data) {
                const awsSpans = getAwsSpans();
                expect(awsSpans.length).toBe(1);
                expect(awsSpans[0].attributes['attribute from hook']).toStrictEqual(bucketName);
                done();
            });
        });

        it('preRequestHook throws does not fail span', (done) => {
            mockAwsSend(responseMockSuccess, 'data returned from operation');
            const config = {
                preRequestHook: (span: Span, request: any) => {
                    throw new Error('error from request hook');
                },
            };

            instrumentation.disable();
            instrumentation.setConfig(config);
            instrumentation.enable();

            const s3 = new AWS.S3();
            const bucketName = 'aws-test-bucket';

            s3.createBucket({ Bucket: bucketName }, async function (err, data) {
                const awsSpans = getAwsSpans();
                expect(awsSpans.length).toBe(1);
                expect(awsSpans[0].status.code).toStrictEqual(SpanStatusCode.UNSET);
                done();
            });
        });

        it('responseHook called and add response attribute to span', (done) => {
            mockAwsSend(responseMockSuccess, 'data returned from operation');
            const config = {
                responseHook: (span: Span, response: any) => {
                    span.setAttribute('attribute from response hook', response['data']);
                },
            };

            instrumentation.disable();
            instrumentation.setConfig(config);
            instrumentation.enable();

            const s3 = new AWS.S3();
            const bucketName = 'aws-test-bucket';

            s3.createBucket({ Bucket: bucketName }, async function (err, data) {
                const awsSpans = getAwsSpans();
                expect(awsSpans.length).toBe(1);
                expect(awsSpans[0].attributes['attribute from response hook']).toStrictEqual(
                    'data returned from operation'
                );
                done();
            });
        });

        it('suppressInternalInstrumentation set to true with send()', (done) => {
            mockAwsSend(responseMockSuccess, 'data returned from operation', true);
            const config = {
                suppressInternalInstrumentation: true,
            };

            instrumentation.disable();
            instrumentation.setConfig(config);
            instrumentation.enable();

            const s3 = new AWS.S3();

            s3.createBucket({ Bucket: 'aws-test-bucket' }, function (err, data) {
                const awsSpans = getAwsSpans();
                expect(awsSpans.length).toBe(1);
                done();
            });
        });

        it('suppressInternalInstrumentation set to true with promise()', async () => {
            mockAwsSend(responseMockSuccess, 'data returned from operation', true);
            const config = {
                suppressInternalInstrumentation: true,
            };

            instrumentation.disable();
            instrumentation.setConfig(config);
            instrumentation.enable();

            const s3 = new AWS.S3();

            await s3.createBucket({ Bucket: 'aws-test-bucket' }).promise();
            const awsSpans = getAwsSpans();
            expect(awsSpans.length).toBe(1);
        });

        it('setting moduleVersionAttributeName is adding module version', async () => {
            mockAwsSend(responseMockSuccess, 'data returned from operation', true);
            const config = {
                moduleVersionAttributeName: 'module.version',
                suppressInternalInstrumentation: true,
            };

            instrumentation.disable();
            instrumentation.setConfig(config);
            instrumentation.enable();

            const s3 = new AWS.S3();

            await s3.createBucket({ Bucket: 'aws-test-bucket' }).promise();
            const awsSpans = getAwsSpans();
            expect(awsSpans.length).toBe(1);

            expect(awsSpans[0].attributes['module.version']).toMatch(/2.\d{1,4}\.\d{1,5}.*/);
        });
    });
});
