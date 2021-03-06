#!/usr/bin/env node

'use strict';

const os = require('os');
const fs = require('fs');
const CLI = require('clui');
const path = require('path');
const AWS = require('aws-sdk');
const clc = require('cli-color');
const fuzzy = require('fuzzy.js');
const inquirer = require('inquirer');
const rightPad = require('right-pad');
const execSync = require('child_process').execSync;
const regions = require('./regions');

fuzzy.analyzeSubTerms = true;
fuzzy.analyzeSubTermDepth = 100;
fuzzy.highlighting = {
  before: '<§$',
  after: '$§>'
};
const fuzzyMarkerReplacementRegex = /<§\$(.*?)\$§>/g;

const cachePath = path.join(os.tmpdir(), 'ec2c-cache.json');
const cacheExpiration = process.env.EC2C_CACHE_EXPIRY ?
  parseInt(process.env.EC2C_CACHE_EXPIRY, 10) :
  1000 * 60 * 5;

// Immediately start downloading instance data 'cause that
// might take quite some time.
const allInstances = getAllInstances();

const privateKey = process.env.EC2C_PRIVATE_KEY || undefined;
const defaultUserName = process.env.EC2C_DEFAULT_USER_NAME || undefined;

const spinner = new CLI.Spinner('Downloading instance data…');

inquirer.prompt([
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
  ])
  .then(answers => {
    spinner.start();
    return allInstances
      .then(instances => {
        spinner.stop();
        selectInstanceAndStart(answers.filter, answers.user, instances);
      }, error => {
        console.error(clc.red('Couldn\'t retrieve instances from EC2.'), error);
        process.exit(1);
      })
  })
  .then(null, error => {
    console.error(clc.red('An unknown error occured.'), error);
    process.exit(1);
  });;


function selectInstanceAndStart(filter, user, instances) {
  inquirer.prompt(
    [
      {
        type: 'list',
        name: 'instance',
        message: 'Which system would you like to connect to?',
        choices: buildUpInstancePrompt(filter, instances)
      }
    ]).then(answers => {
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
    });
}


function buildUpInstancePrompt(filter, instances) {
  const longestInstanceName = instances.reduce((prev, instance) => {
    const name = getName(instance);
    if (prev.length <= name.length) {
      return name;
    }
    return prev;
  }, '');

  const rightPadLength = longestInstanceName.length + 2;

  const choices = instances.reduce((choices, instance) => {
    const choice = {};
    const name = getName(instance) || '<unnamed>';
    const fuzzyResult = fuzzy(rightPad(name, rightPadLength), filter);
    const highlightedName = fuzzyResult.highlightedTerm
      .replace(fuzzyMarkerReplacementRegex, (match, p1) => clc.blue(p1));

    choice.value = instance.PublicDnsName;
    choice.name = highlightedName +
      clc.blackBright(
        ' (' +
        getInstanceState(instance) +
        instance.Placement.AvailabilityZone +
        getInstancePublicHostname(instance) +
        ')'
      );
    choice.short = name;
    choice.score = fuzzyResult.score;
    choices.push(choice);
    return choices;
  }, []);

  choices.sort((a, b) => {
    if (a.score === b.score) {
      if (a.short.length < b.short.length) {
        return 1;
      } else if (a.short.length > b.short.length) {
        return -1;
      }
      return a.short.localeCompare(b.short);
    }
    return a.score - b.score;
  });

  choices.reverse();

  return choices;
}


function getName(instance) {
  for (let i = 0; i < instance.Tags.length; i++) {
    if (instance.Tags[i].Key.toLowerCase() === 'name') {
      return instance.Tags[i].Value;
    }
  }

  return instance.PublicDnsName;
}


function getInstanceState(instance) {
  const state = instance.State.Name;
  if (state !== 'running') {
    return clc.redBright(state.toUpperCase()) + ', ';
  }
  return '';
}


function getInstancePublicHostname(instance) {
  return ', ' + instance.PublicDnsName;
}


function getAllInstances() {
  return getCachedInstances()
    .then(null, () => {
      return loadAllInstances()
        .then(instances => {
          writeInstancesCache(instances);
          return instances;
        });
    });
}


function getCachedInstances() {
  return new Promise(resolve => resolve(fs.readFileSync(cachePath, {encoding: 'utf8'})))
    .then(content => JSON.parse(content))
    .then(json => {
      if (json.cachedAt >= Date.now() - cacheExpiration) {
        return json.instances;
      }

      throw new Error('Cache is out of date.');
    });
}


function writeInstancesCache(instances) {
  const cacheContent = {
    cachedAt: Date.now(),
    instances
  };
  fs.writeFileSync(cachePath, JSON.stringify(cacheContent, 0, 2), {encoding: 'utf8'});
}


function loadAllInstances() {
  const instanceRetrievalPromises = regions.map(region => {
    return loadInstances(region)
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


function loadInstances(region) {
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
