import _ from 'lodash';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import cp from 'child_process';

/**
 * Initialize plugin with command options
 *
 * @param {Object} commander
 * @returns {Object}
 */
export function init(commander) {
  const text = '(optional) Google Cloud Platform\'s app.yml file used to config the deploy';

  commander
    .option('--app-file <appFile>', text)
    .option('--key-file <keyFile>', '(optional) the Google Cloud JSON key file')
    .option('--project-id <projectID>', '(optional) the Google Cloud project ID')
    .option('--cron-file <cronFile>', '(optional) specify cron\'s file to deploy as well');

  return commander;
}

function prepareConfig(pluginConfigRaw, commander) {
  // eslint-disable-next-line no-underscore-dangle
  const args = _.find(commander.commands, command => command._name === 'google-app-engine');

  const pluginConfig = pluginConfigRaw[1];
  const appFileName = args.appFile || './app.yml';
  const appFile = yaml.safeLoad(fs.readFileSync(path.join(process.cwd(), appFileName), 'utf8'));

  return {
    appFileName,
    appFile,
    secrets: pluginConfig ? pluginConfig.secrets : [],
    project: args.projectId || null,
    keyFile: args.keyFile || null,
    version: args.version || null,
    secretVars: {},
    cronFile: args.cronFile,
  };
}

function retrievePlugin(plugin) {
  return plugin[0] === 'google-app-engine';
}

function rejectIfMissingPluginConfig(reject) {
  const message = 'Missing plugin\'s configuration properties. See all mandatory properties ' +
    'in the documentation: https://github.com/nicolascava/felfire-google-app-engine#configuration.';

  return reject(message);
}

function rejectIfMissingAppConfig(reject) {
  const message = 'There is no \'app.yml\' at the root of your project. Please define one to let ' +
    'Felfire deploy to Google App Engine.';

  return reject(message);
}

function resolveSecrets(secretVars, reject) {
  return (secret) => {
    const mutableSecretVars = secretVars;

    if (!process.env[secret]) return reject(`Environment variable doesn't exist: ${secret}.`);

    mutableSecretVars[secret] = process.env[secret];

    return secret;
  };
}

function rejectIfMissingKeyFile(reject) {
  const message = 'Missing key file. Felfire is unable to authenticate itself on Google ' +
    'Cloud Platform.';

  return reject(message);
}

function deploy(appFileName) {
  const deployCommand = `gcloud app deploy ${appFileName} --quiet --stop-previous-version ' +
    '--promote`;

  return cp.execSync(deployCommand);
}

function deployCron(cronFile) {
  const cronCommand = `gcloud app deploy ${cronFile} --quiet`;

  return cp.execSync(cronCommand);
}

/**
 * Update Google App Engine configuration based on given clear and secret environment variables
 *
 * @param {Object} commander
 * @param {Object} compiler
 * @returns {Promise}
 */
export default function ({ commander, compiler }) {
  return new Promise((resolve, reject) => {
    const pluginConfigRaw = _.find(compiler.config.plugins, retrievePlugin);

    if (!pluginConfigRaw) return rejectIfMissingPluginConfig(reject);

    const {
      appFileName,
      appFile,
      secrets,
      project,
      keyFile,
      secretVars,
      cronFile,
    } = prepareConfig(pluginConfigRaw, commander);

    if (!appFile) return rejectIfMissingAppConfig(reject);
    if (!_.isEmpty(secrets)) secrets.forEach(resolveSecrets(secretVars, reject));

    if (!fs.existsSync(path.resolve(process.cwd(), keyFile))) {
      return rejectIfMissingKeyFile(reject);
    }

    const newAppFile = {
      ...appFile,
      env_variables: {
        ...appFile.env_variables,
        ...compiler.config.environment.production,
        ...secretVars,
      },
    };
    const authCommand = `gcloud auth activate-service-account --key-file ${keyFile}`;
    const setProjectCommand = `gcloud config set project ${project}`;

    fs.writeFileSync(appFileName, yaml.safeDump(newAppFile), 'utf8');

    try {
      cp.execSync(authCommand);
      cp.execSync(setProjectCommand);

      deploy(appFileName);

      if (cronFile) deployCron(cronFile);

      return resolve();
    } catch (error) {
      return reject(error);
    }
  });
}
