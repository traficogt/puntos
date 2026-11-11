from odoo import release
if release.version_info[:2] != (18, 0):
    raise ImportError('Puntos Fieles POS Connector supports Odoo 18.0 only.')
from . import models
from . import wizard
