var expect = require('expect.js');
var simple = require('simple-mock');
var fs = require('fs');
var validationErrorFormatter = require('./validation-error-message-formatter.js');

// Placeholders for stubbing built-in Sync Gateway support functions.
// More info: http://developer.couchbase.com/mobile/develop/guides/sync-gateway/sync-function-api-guide/index.html
var requireAccess;
var channel;
var access;

var syncFunction;

var defaultWriteChannel = 'write';

function init(syncFunctionPath) {
  // Load the contents of the sync function file into a global variable called syncFunction
  /*jslint evil: true */
  eval('syncFunction = ' + fs.readFileSync(syncFunctionPath).toString());
  /*jslint evil: false */

  requireAccess = simple.stub();
  channel = simple.stub();
  access = simple.stub();
}

function verifyRequireAccess(expectedChannels) {
  expect(requireAccess.callCount).to.be(1);

  checkChannels(expectedChannels, requireAccess.calls[0].arg);
}

function verifyChannelAssignment(expectedChannels) {
  expect(channel.callCount).to.be(1);

  checkChannels(expectedChannels, channel.calls[0].arg);
}

function checkChannels(expectedChannels, actualChannels) {
  if (!(expectedChannels instanceof Array)) {
    expectedChannels = [ expectedChannels ];
  }

  if (!(actualChannels instanceof Array)) {
    actualChannels = [ actualChannels ];
  }

  for (var expectedChannelIndex = 0; expectedChannelIndex < expectedChannels.length; expectedChannelIndex++) {
    expect(actualChannels).to.contain(expectedChannels[expectedChannelIndex]);
  }

  // Rather than compare the sizes of the two lists, which leads to an obtuse error message on failure (e.g. "expected 2 to be 3"), ensure
  // that neither list of channels contains an element that does not exist in the other
  for (var actualChannelIndex = 0; actualChannelIndex < actualChannels.length; actualChannelIndex++) {
    var channel = actualChannels[actualChannelIndex];
    if (expectedChannels.indexOf(channel) < 0) {
      expect().fail('Unexpected channel encountered: ' + channel);
    }
  }
}

function verifyAccessAssignments(expectedAccessAssignments) {
  var expectedAccessCallCount = 0;
  for (var assignmentIndex = 0; assignmentIndex < expectedAccessAssignments.length; assignmentIndex++) {
    var expectedAssignment = expectedAccessAssignments[assignmentIndex];

    var expectedUsersAndRoles = [ ];
    if (expectedAssignment.expectedUsers) {
      if (expectedAssignment.expectedUsers instanceof Array) {
        for (var userIndex = 0; userIndex < expectedAssignment.expectedUsers.length; userIndex++) {
          expectedUsersAndRoles.push(expectedAssignment.expectedUsers[userIndex]);
        }
      } else {
        expectedUsersAndRoles.push(expectedAssignment.expectedUsers);
      }
    }

    if (expectedAssignment.expectedRoles) {
      if (expectedAssignment.expectedRoles instanceof Array) {
        for (var roleIndex = 0; roleIndex < expectedAssignment.expectedRoles.length; roleIndex++) {
          var roleName = expectedAssignment.expectedRoles[roleIndex];
          // The prefix "role:" must be applied to roles when calling the access function, as specified by
          // http://developer.couchbase.com/documentation/mobile/current/develop/guides/sync-gateway/channels/developing/index.html#programmatic-authorization
          if (roleName.indexOf('role:') >= 0) {
            expectedUsersAndRoles.push(roleName);
          } else {
            expectedUsersAndRoles.push('role:' + roleName);
          }
        }
      } else {
        expectedUsersAndRoles.push(expectedAssignment.expectedRoles);
      }
    }

    var expectedChannels = [ ];
    if (expectedAssignment.expectedChannels) {
      if (expectedAssignment.expectedChannels instanceof Array) {
        for (var channelIndex = 0; channelIndex < expectedAssignment.expectedChannels.length; channelIndex++) {
          expectedChannels.push(expectedAssignment.expectedChannels[channelIndex]);
        }
      } else {
        expectedChannels.push(expectedAssignment.expectedChannels);
      }
    }

    expect(access.calls[expectedAccessCallCount].args[0]).to.eql(expectedUsersAndRoles);
    expect(access.calls[expectedAccessCallCount].args[1]).to.eql(expectedChannels);

    expectedAccessCallCount++;
  }

  expect(access.callCount).to.be(expectedAccessCallCount);
}

function verifyDocumentAccepted(doc, oldDoc, expectedChannels, expectedAccessAssignments) {
  syncFunction(doc, oldDoc);

  verifyRequireAccess(expectedChannels);

  if (expectedAccessAssignments) {
    verifyAccessAssignments(expectedAccessAssignments);
  }

  expect(channel.callCount).to.equal(1);

  var actualChannels = channel.calls[0].arg;
  if (expectedChannels instanceof Array && actualChannels instanceof Array) {
    for (var channelIndex = 0; channelIndex < expectedChannels.length; channelIndex++) {
      expect(actualChannels).to.contain(expectedChannels[channelIndex]);
    }
  } else {
    expect(actualChannels).to.contain(expectedChannels);
  }
}

function verifyDocumentCreated(doc, expectedChannels, expectedAccessAssignments) {
  verifyDocumentAccepted(doc, undefined, expectedChannels || defaultWriteChannel, expectedAccessAssignments);
}

function verifyDocumentReplaced(doc, oldDoc, expectedChannels, expectedAccessAssignments) {
  verifyDocumentAccepted(doc, oldDoc, expectedChannels || defaultWriteChannel, expectedAccessAssignments);
}

function verifyDocumentDeleted(oldDoc, expectedChannels, expectedAccessAssignments) {
  verifyDocumentAccepted({ _id: oldDoc._id, _deleted: true }, oldDoc, expectedChannels || defaultWriteChannel, expectedAccessAssignments);
}

function verifyDocumentRejected(doc, oldDoc, docType, expectedErrorMessages, expectedChannels) {
  expect(syncFunction).withArgs(doc, oldDoc).to.throwException(function(ex) {
    verifyValidationErrors(docType, expectedErrorMessages, ex);
  });

  verifyRequireAccess(expectedChannels);

  expect(channel.callCount).to.equal(0);
}

function verifyDocumentNotCreated(doc, docType, expectedErrorMessages, expectedChannels) {
  verifyDocumentRejected(doc, undefined, docType, expectedErrorMessages, expectedChannels || defaultWriteChannel);
}

function verifyDocumentNotReplaced(doc, oldDoc, docType, expectedErrorMessages, expectedChannels) {
  verifyDocumentRejected(doc, oldDoc, docType, expectedErrorMessages, expectedChannels || defaultWriteChannel);
}

function verifyDocumentNotDeleted(oldDoc, docType, expectedErrorMessages, expectedChannels) {
  verifyDocumentRejected({ _id: oldDoc._id, _deleted: true }, oldDoc, docType, expectedErrorMessages, expectedChannels || defaultWriteChannel);
}

function verifyValidationErrors(docType, expectedErrorMessages, exception) {
  if (!(expectedErrorMessages instanceof Array)) {
    expectedErrorMessages = [ expectedErrorMessages ];
  }

  // Used to split the leading component (e.g. "Invalid foobar document") from the validation error messages, which are separated by a colon
  var validationErrorRegex = /^([^:]+):\s*(.+)$/;

  var exceptionMessageMatches = validationErrorRegex.exec(exception.forbidden);
  expect(exceptionMessageMatches.length).to.be(3);

  var invalidDocMessage = exceptionMessageMatches[1].trim();
  expect(invalidDocMessage).to.equal('Invalid ' + docType + ' document');

  var actualErrorMessages = exceptionMessageMatches[2].trim().split(/;\s*/);

  for (var expectedErrorIndex = 0; expectedErrorIndex < expectedErrorMessages.length; expectedErrorIndex++) {
    expect(actualErrorMessages).to.contain(expectedErrorMessages[expectedErrorIndex]);
  }

  // Rather than compare the sizes of the two lists, which leads to an obtuse error message on failure (e.g. "expected 2 to be 3"), ensure
  // that neither list of validation errors contains an element that does not exist in the other
  for (var actualErrorIndex = 0; actualErrorIndex < actualErrorMessages.length; actualErrorIndex++) {
    var errorMessage = actualErrorMessages[actualErrorIndex];
    if (expectedErrorMessages.indexOf(errorMessage) < 0) {
      expect().fail('Unexpected validation error: ' + errorMessage);
    }
  }
}

function verifyAccessDenied(doc, oldDoc, expectedChannels) {
  var expectedError = new Error('access denied');
  requireAccess = simple.stub().throwWith(expectedError);

  expect(syncFunction).withArgs(doc, oldDoc).to.throwException(function(ex) {
    expect(ex.message).to.equal(expectedError.message);
  });

  verifyRequireAccess(expectedChannels);
}

function verifyUnknownDocumentType(doc, oldDoc) {
  expect(syncFunction).withArgs(doc, oldDoc).to.throwException(function(ex) {
    expect(ex.forbidden).to.equal('Unknown document type');
  });

  expect(requireAccess.callCount).to.be(0);
  expect(channel.callCount).to.be(0);
}

/**
 * Initializes the module with the sync function at the specified file path.
 *
 * @param {string} syncFunctionPath The path to the sync function to load
 */
exports.init = init;

/**
 * Attempts to write the specified doc and then verifies that it completed successfully with the expected channels.
 *
 * @param {Object} doc The document to write. May include property "_deleted=true" to simulate a delete operation.
 * @param {Object} oldDoc The document to replace or delete. May be null or undefined or include property "_deleted=true" to simulate a
 *                        create operation.
 * @param {string[]} expectedChannels The list of channels that are required to perform the operation. May be a string if only one channel
 *                                    is expected.
 * @param {Object[]} [expectedAccessAssignments] An optional list of expected user and role channel assignments. Each entry is an object
 *                                               that contains the following fields:
 *                                               - channels: an optional list of channels to assign to the users and roles
 *                                               - users: an optional list of users to which to assign the channels
 *                                               - roles: an optional list of roles to which to assign the channels
 */
exports.verifyDocumentAccepted = verifyDocumentAccepted;

/**
 * Attempts to create the specified doc and then verifies that it completed successfully with the expected channels.
 *
 * @param {Object} doc The new document
 * @param {string[]} [expectedChannels] The list of channels that are required to perform the operation. May be a string if only one channel
 *                                      is expected. Set to "write" by default if omitted.
 * @param {Object[]} [expectedAccessAssignments] An optional list of expected user and role channel assignments. Each entry is an object
 *                                               that contains the following fields:
 *                                               - channels: an optional list of channels to assign to the users and roles
 *                                               - users: an optional list of users to which to assign the channels
 *                                               - roles: an optional list of roles to which to assign the channels
 */
exports.verifyDocumentCreated = verifyDocumentCreated;

/**
 * Attempts to replace the specified doc and then verifies that it completed successfully with the expected channels.
 *
 * @param {Object} doc The updated document
 * @param {Object} oldDoc The document to replace
 * @param {string[]} [expectedChannels] The list of channels that are required to perform the operation. May be a string if only one channel
 *                                      is expected. Set to "write" by default if omitted.
 * @param {Object[]} [expectedAccessAssignments] An optional list of expected user and role channel assignments. Each entry is an object
 *                                               that contains the following fields:
 *                                               - channels: an optional list of channels to assign to the users and roles
 *                                               - users: an optional list of users to which to assign the channels
 *                                               - roles: an optional list of roles to which to assign the channels
 */
exports.verifyDocumentReplaced = verifyDocumentReplaced;

/**
 * Attempts to delete the specified doc and then verifies that it completed successfully with the expected channels.
 *
 * @param {Object} oldDoc The document to delete
 * @param {string[]} [expectedChannels] The list of channels that are required to perform the operation. May be a string if only one channel
 *                                      is expected. Set to "write" by default if omitted.
 * @param {Object[]} [expectedAccessAssignments] An optional list of expected user and role channel assignments. Each entry is an object
 *                                               that contains the following fields:
 *                                               - channels: an optional list of channels to assign to the users and roles
 *                                               - users: an optional list of users to which to assign the channels
 *                                               - roles: an optional list of roles to which to assign the channels
 */
exports.verifyDocumentDeleted = verifyDocumentDeleted;

/**
 * Attempts to write the specified doc and then verifies that it failed validation with the expected channels.
 *
 * @param {Object} doc The document to write. May include property "_deleted=true" to simulate a delete operation.
 * @param {Object} oldDoc The document to replace or delete. May be null or undefined or include property "_deleted=true" to simulate a
 *                        create operation.
 * @param {string} docType The document's type as specified in the document definition
 * @param {string[]} expectedErrorMessages The list of validation error messages that should be generated by the operation. May be a string
 *                                         if only one validation error is expected.
 * @param {string[]} expectedChannels The list of channels that are required to perform the operation. May be a string if only one channel
 *                                    is expected.
 */
exports.verifyDocumentRejected = verifyDocumentRejected;

/**
 * Attempts to create the specified doc and then verifies that it failed validation with the expected channels.
 *
 * @param {Object} doc The new document
 * @param {string} docType The document's type as specified in the document definition
 * @param {string[]} expectedErrorMessages The list of validation error messages that should be generated by the operation. May be a string
 *                                         if only one validation error is expected.
 * @param {string[]} [expectedChannels] The list of channels that are required to perform the operation. May be a string if only one channel
 *                                      is expected. Set to "write" by default if omitted.
 */
exports.verifyDocumentNotCreated = verifyDocumentNotCreated;

/**
 * Attempts to replace the specified doc and then verifies that it failed validation with the expected channels.
 *
 * @param {Object} doc The updated document
 * @param {Object} oldDoc The document to replace
 * @param {string} docType The document's type as specified in the document definition
 * @param {string[]} expectedErrorMessages The list of validation error messages that should be generated by the operation. May be a string
 *                                         if only one validation error is expected.
 * @param {string[]} [expectedChannels] The list of channels that are required to perform the operation. May be a string if only one channel
 *                                      is expected. Set to "write" by default if omitted.
 */
exports.verifyDocumentNotReplaced = verifyDocumentNotReplaced;

/**
 * Attempts to delete the specified doc and then verifies that it failed validation with the expected channels.
 *
 * @param {Object} oldDoc The document to delete
 * @param {string} docType The document's type as specified in the document definition
 * @param {string[]} expectedErrorMessages The list of validation error messages that should be generated by the operation. May be a string
 *                                         if only one validation error is expected.
 * @param {string[]} [expectedChannels] The list of channels that are required to perform the operation. May be a string if only one channel
 *                                      is expected. Set to "write" by default if omitted.
 */
exports.verifyDocumentNotDeleted = verifyDocumentNotDeleted;

/**
 * Verifies that the given exception result of a document write operation includes the specified validation error messages.
 *
 * @param {Object} docType The document's type as specified in the document definition
 * @param {string[]} expectedErrorMessages The list of validation error messages that should be contained in the exception. May be a string
 *                                         if only one validation error is expected.
 * @param {Object} exception The exception that was thrown by the sync function. Should include a "forbidden" property of type string.
 */
exports.verifyValidationErrors = verifyValidationErrors;

/**
 * Verifies that the specified the document that was created, replaced or deleted required the specified channels for access.
 *
 * @param {string[]} expectedChannels The list of channels that are required to perform the operation. May be a string if only one channel
 *                                    is expected.
 */
exports.verifyRequireAccess = verifyRequireAccess;

/**
 * Verifies that the specified channels were all assigned to a document that was created, replaced or deleted.
 *
 * @param {string[]} expectedChannels The list of channels that should have been assigned to the document. May be a string if only one
 *                                    channel is expected.
 */
exports.verifyChannelAssignment = verifyChannelAssignment;

/**
 * Verifies that the sync function throws an error when authorization is denied to create/replace/delete a document.
 *
 * @param {Object} doc The document to attempt to write. May include property "_deleted=true" to simulate a delete operation.
 * @param {Object} oldDoc The document to replace or delete. May be null or undefined or include property "_deleted=true" to simulate a
 *                        create operation.
 * @param {string[]} expectedChannels The list of channels that are required to perform the operation. May be a string if only one channel
 *                                    is expected.
 */
exports.verifyAccessDenied = verifyAccessDenied;

/**
 * Verifies that the given document's type is unknown/invalid.
 *
 * @param {Object} doc The document to attempt to write. May include property "_deleted=true" to simulate a delete operation.
 * @param {Object} oldDoc The document to replace or delete. May be null or undefined or include property "_deleted=true" to simulate a
 *                        create operation.
 */
exports.verifyUnknownDocumentType = verifyUnknownDocumentType;

/**
 * An object that contains functions that are used to format expected validation error messages in specifications. Documentation can be
 * found in the "validation-error-message-formatter" module.
 */
exports.validationErrorFormatter = validationErrorFormatter;
