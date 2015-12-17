#!/usr/bin/env node

'use strict';

const CLI = require('clui');
const AWS = require('aws-sdk');
const clc = require('cli-color');
const fuzzy = require('fuzzy.js');
const inquirer = require('inquirer');
const execSync = require('child_process').execSync;
const regions = require('./regions');

fuzzy.analyzeSubTerms = true;
fuzzy.analyzeSubTermDepth = 30;
fuzzy.highlighting = {
  before: '<§$',
  after: '$§>'
};
const fuzzyMarkerReplacementRegex = /<§\$(.*?)\$§>/g;

// Immediately start downloading instance data 'cause that
// might take quite some time.
const allInstances = getAllInstances();

const privateKey = process.env.EC2C_PRIVATE_KEY || undefined;
const defaultUserName = process.env.EC2C_DEFAULT_USER_NAME || undefined;

inquirer.prompt(
  [
    {
      type: 'input',
      name: 'filter',
      message: 'What are you looking for?',
      'default': getDefaultQuery()
    },
    {
      type: 'input',
      name: 'user',
      message: 'As who would you like to connect?',
      'default': defaultUserName
    }
  ],
  answers => {
    const spinner = new CLI.Spinner('Downloading instance data…');
    spinner.start();
    allInstances.then(instances => {
      spinner.stop();
      selectInstanceAndStart(answers.filter, answers.user, instances);
    }, error => {
      console.error(clc.red('Couldn\'t retrieve instances from EC2.'), error);
      process.exit(1);
    })
    .then(null, error => {
      console.error(clc.red('An unknown error occured.'), error);
      process.exit(1);
    });
  }
);


function selectInstanceAndStart(filter, user, instances) {
  inquirer.prompt(
    [
      {
        type: 'list',
        name: 'instance',
        message: 'Which system would you like to connect to?',
        choices: buildUpInstancePrompt(filter, instances)
      }
    ],
    answers => {
      let command = 'ssh ';
      if (privateKey) {
        command += '-i ' + privateKey + ' ';
      }
      if (user) {
        command += user + '@';
      }
      command += answers.instance;
      console.log('Executing: ' + clc.yellow(command));

      try {
        execSync(command, {
          stdio: 'inherit'
        });
      } catch (e) {
        // We can safely ignore all reported issues as the output of SSH is send
        // to stdout and stderr. Meaning: The user will see the error anyway
        // and it provides no value to log an additional ec2c stacktrace.
        // What should exit with the code of the child process to provide
        // useful exit codes.
        process.exit(e.status);
      }
    }
  );
}


function buildUpInstancePrompt(filter, instances) {
  const choices = instances.reduce((choices, instance) => {
    const choice = {};
    const name = getName(instance);
    const fuzzyResult = fuzzy(name, filter);
    const highlightedName = fuzzyResult.highlightedTerm
      .replace(fuzzyMarkerReplacementRegex, (match, p1) => clc.blue(p1));

    choice.value = instance.PublicDnsName;
    choice.name = highlightedName +
      clc.blackBright(' (' + instance.Placement.AvailabilityZone + ')');
    choice.short = name;
    choice.score = fuzzyResult.score;
    choices.push(choice);
    return choices;
  }, []);

  choices.sort((a, b) => {
    if (a.score === b.score) {
      return a.short.localeCompare(b.short);
    }
    return a.score - b.score;
  });

  choices.reverse();

  return choices;
}


function getName(instance) {
  for (let i = 0; i < instance.Tags.length; i++) {
    if (instance.Tags[i].Key === 'Name') {
      return instance.Tags[i].Value;
    }
  }

  return instance.PublicDnsName;
}


function getAllInstances() {
  const instanceRetrievalPromises = regions.map(region => {
    return getInstances(region)
      .then(null, (err) => {
        console.error('Failed to retrieve instances for region %s', region);

        // Allow us to continue even if we cannot retrieve information
        // for a single region.
        return [];
      });
  });

  return Promise.all(instanceRetrievalPromises)
    .then(instancesArray => {
      // flatten instances
      return instancesArray.reduce((agg, instances) => agg.concat(instances), []);
    });
}


function getInstances(region) {
  const ec2 = new AWS.EC2({region: region});
  return new Promise((resolve, reject) => {
    ec2.describeInstances((err, result) => {
      if (err) {
        reject(err);
      } else if (result) {
        const instances = result.Reservations.reduce((instances, reservation) => {
          return instances.concat(reservation.Instances);
        }, []);
        resolve(instances);
      }
    });
  });
}


function getDefaultQuery() {
  if (process.argv.length < 3) {
    return undefined;
  }

  return process.argv.slice(2).join(' ');
}
